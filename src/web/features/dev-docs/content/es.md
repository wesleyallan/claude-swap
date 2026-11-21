## Visión general

Esta página es para desarrolladores: con qué está hecho Claude Swap, por qué, y cómo encajan las piezas. La guía de uso está en el modal **Documentación** del panel; la especificación y el registro completo de decisiones están en `docs/architecture.md`.

Claude Swap mantiene **Claude Code** conectado a la mejor de varias cuentas de Claude. Tres ideas guiaron todas las decisiones:

- **Ligero y local.** Un proceso de Node en `127.0.0.1`, con menos de 100 MB de memoria en reposo. Sin base de datos, sin Docker, sin servicios en la nube: nada que instalar aparte de Node.js.
- **El orden es la verdad.** El orden de la lista de cuentas es la prioridad, y un cambio manual es solo reordenar. Los modos automático y manual nunca se contradicen.
- **Nunca perder un token.** Claude Code rota los refresh tokens. Toda escritura es atómica, y el login activo siempre se guarda antes de reemplazarlo.

## Tecnologías

| Capa | Tecnología | Por qué |
| --- | --- | --- |
| Runtime | **Node.js 24** | Ya incluye `fetch`, `CompressionStream`, `AbortSignal.timeout` y APIs de archivos, así que el servidor necesita muy pocas dependencias. |
| HTTP | **Hono** + `@hono/node-server` | Pocos kB, rápido y tipado de punta a punta: la web llama a la API con el cliente RPC de Hono, sin generar código. Elegido en lugar de Next.js porque un servicio siempre encendido debe ser pequeño y un solo panel no necesita SSR. |
| Validación | **zod 4** | Toda frontera (archivos de configuración, archivos de Claude Code, respuestas de Anthropic, cuerpos de petición) se valida, nunca se da por buena. Los codecs convierten cadenas ISO en `Date` y viceversa. |
| Build | **tsup** (servidor), **Vite** (web) | tsup empaqueta el servidor y sus dependencias en un solo archivo, así el servicio no necesita `node_modules`. Vite da HMR en desarrollo y archivos con hash, cacheables, en producción. |
| UI | **React 19** | Maduro, conocido, y el ecosistema de abajo está hecho para él. |
| Rutas | **TanStack Router** | Rutas en código con tipos. Los modales son rutas, así que se pueden enlazar y el botón atrás funciona. |
| Estado del servidor | **TanStack Query** | Polling, caché, mutaciones optimistas con rollback y pausa mientras la pestaña está oculta. |
| Estilos | **Tailwind CSS v4** + **shadcn/ui** (Base UI) | Tokens de diseño de `DESIGN.md` como variables CSS, temas claro y oscuro, componentes accesibles que son código propio. |
| Gráficos / arrastrar | **Recharts** (chart de shadcn), **dnd-kit** | Las dos bibliotecas de UI más pesadas, ambas cargadas bajo demanda fuera del bundle inicial. dnd-kit trae arrastre con teclado y anuncios para lectores de pantalla. |
| i18n | **use-intl** | Mensajes ICU (plurales, tiempo relativo) en `en`, `es` y `pt-BR`, con claves tipadas. |
| Calidad | **TypeScript 7** (strict), **Biome**, **Vitest**, **Testing Library**, **Playwright** | Una herramienta rápida para lint y formato; pruebas unitarias, de integración y de punta a punta sin cuentas reales. |

## Arquitectura

El código sigue una **arquitectura hexagonal** (ports and adapters). Las dependencias apuntan hacia dentro:

```
web ──(solo tipos)──▶ server ──▶ application ──▶ domain
                         │             ▲
                         └──▶ infrastructure (implementa los ports de application)
```

- **domain** — TypeScript puro: cuentas, ventanas de uso, la política de rotación, el orden. Sin I/O, sin Node, sin React, 100 % de cobertura de pruebas.
- **application** — el motor y los casos de uso. Habla con el exterior solo mediante **ports** (interfaces en `ports.ts`): repositorios, la sesión de Claude Code, la API de Anthropic, reloj, logger, mutex.
- **infrastructure** — **adapters** que implementan esos ports: repositorios en archivos JSON, los archivos de Claude Code, el cliente HTTP de Anthropic, el reloj y el logger del sistema.
- **server** — la **composition root** (`container.ts`, el único lugar que instancia adapters), las rutas de Hono y los mapeadores de DTO.
- **web** — la SPA de React. Importa código del servidor solo como tipos, para tipar el cliente RPC.

Estas reglas no son solo una convención: `src/architecture.test.ts` revisa todos los imports y rompe el build cuando una capa accede a lo que no debe. El tiempo se inyecta con el port `Clock`, así que el código de negocio nunca llama a `Date.now()` y todo escenario se puede probar.

## Estructura del proyecto

```
src/
  domain/          account, usage, rotation-policy, ordering, preferences, errors
  application/     ports.ts, engine.ts, use-cases/, testing/ (fakes en memoria)
  infrastructure/
    fs/            escritura atómica, archivo JSON versionado, migraciones, rutas
    repositories/  repositorios de config, secrets y state + esquemas zod
    claude-code/   lee y escribe los archivos de login de Claude Code
    anthropic/     endpoint de uso y renovación de token OAuth
    system/        reloj, logger JSON con enmascarado, mutex de promesas
  server/          main.ts, cli.ts, container.ts, app.ts (rutas), dto.ts
  web/             router, providers, features/, components/ui (shadcn), lib/, i18n/
tests/e2e/         specs de Playwright, fixtures con HOME temporal, servidor Anthropic falso
deploy/            plantilla de la unidad systemd de usuario
scripts/           instalar/desinstalar el servicio, presupuesto de rendimiento
```

Las pruebas unitarias están junto al código que prueban (`foo.ts` → `foo.test.ts`).

## El motor

El motor ejecuta un **tick** en cada intervalo de comprobación (3 minutos por defecto). Un tick trabaja sobre una copia en memoria de la configuración y el estado y lo guarda una sola vez al final:

1. **Sincroniza** — lee el login activo de Claude Code. Si es una de nuestras cuentas, guarda sus tokens (Claude Code puede haberlos rotado). Un login desconocido pausa los cambios hasta que se importa.
2. **Renueva** — los tokens de las cuentas inactivas son nuestros: renueva los que caducan en los próximos 10 minutos. Los tokens de la cuenta activa son de Claude Code y nunca los renovamos, para no competir con su propia rotación.
3. **Consulta** — obtiene el uso de cada cuenta habilitada, de dos en dos. Un 401 en una cuenta inactiva provoca una renovación y un reintento; un 429 deja esa cuenta en espera.
4. **Decide** — la función pura `selectActiveAccount` elige la cuenta que debe estar activa.
5. **Cambia** — si no es la activa, vuelve a sincronizar los tokens activos, escribe el login de la cuenta elegida en los archivos de Claude Code y registra el cambio.

Los ticks y las mutaciones de la API comparten un **mutex**, así que nunca se mezclan. Las llamadas a `runNow()` tienen **debounce** (250 ms), así que varios clics se convierten en un solo tick. Cada tick programa el siguiente un intervalo completo después, así que **Forzar comprobación** reinicia la cuenta atrás. Llama a `checkNow()`, que aprovecha un tick ya en curso en lugar de encolar un segundo justo detrás. Reordenar, Usar ahora y habilitar llaman a `runNow()`: necesitan un tick que empiece después del cambio.

## Integración con Claude Code

En Linux, Claude Code guarda el login en dos archivos:

| Archivo | Clave nuestra | Contenido |
| --- | --- | --- |
| `~/.claude/.credentials.json` | `claudeAiOauth` | access token, refresh token, caducidad, scopes |
| `~/.claude.json` | `oauthAccount` | UUID de la cuenta, correo, organización |

Un cambio reemplaza solo esas dos claves y conserva todas las demás tal cual. Ambos archivos se leen y validan antes de escribir nada, así que un archivo mal formado nunca se sobrescribe. Los originales se copian una vez, antes de la primera escritura. Un cambio "a medias" (credenciales de una cuenta con la identidad de otra) se detecta y se reescribe completo.

## Persistencia

No hay base de datos: tres archivos JSON en `~/.config/claude-swap` guardan todo.

- `config.json` — preferencias y cuentas. El orden del array es la prioridad.
- `secrets.json` — tokens OAuth por cuenta, modo `0600`, separados para que la configuración se pueda abrir o compartir con seguridad.
- `state.json` — el último uso de cada cuenta, el historial de uso y el registro de actividad.

Cada archivo tiene un campo `version` y una cadena de migraciones, y se valida con zod. Las escrituras son **atómicas**: archivo temporal → fsync → rename → fsync de la carpeta. Un archivo que no se puede leer se renombra a `*.corrupt-<hora>` y se reemplaza por los valores por defecto, en lugar de tumbar el servicio.

El historial está limitado **por tiempo, no por cantidad**: un punto por cuenta cada 3 minutos en las últimas 24 horas y uno cada 15 minutos hasta 7 días. Su tamaño es el mismo sea cual sea el intervalo de comprobación o el número de cuentas.

## API HTTP

| Ruta | Para qué |
| --- | --- |
| `GET /api/dashboard` | Preferencias, cuentas con estado, último uso, actividad, estado del motor |
| `GET /api/history` | Historial de uso para el gráfico |
| `GET /api/accounts/current` | Con qué cuenta está conectado Claude Code ahora |
| `POST /api/accounts/import` | Importa el login actual de Claude Code |
| `PUT /api/accounts/order` | Reordena (cambio manual) |
| `POST /api/accounts/:id/promote` | Usar ahora: mueve al principio |
| `PATCH /api/accounts/:id` | Renombra, habilita o deshabilita |
| `DELETE /api/accounts/:id` | Elimina una cuenta y sus tokens |
| `GET`/`PATCH /api/preferences` | Lee o cambia la configuración |
| `POST /api/engine/run` | Fuerza una comprobación (aprovecha una en curso); responde cuando termina |

Las rutas son finas: validan la entrada con zod, llaman a un caso de uso y mapean el resultado a un DTO. Los mapeadores de DTO eligen cada campo explícitamente, así que los tokens nunca llegan al navegador (una prueba lo garantiza). Toda respuesta pasa por una **protección de Host/Origin** (contra DNS rebinding y CSRF), una Content-Security-Policy restringida al mismo origen y compresión **gzip**. El `index.html` recibe el tema y el idioma guardados, así la página nunca parpadea con el tema equivocado.

## App web

- **Una pantalla y rutas de modal.** `/settings`, `/docs`, `/accounts/new` y `/accounts/:id/remove` se abren sobre el panel. Esta página (`/doc-dev`) es la única página completa fuera de él, y nada enlaza a ella.
- **Polling.** El panel se pide cada 10 segundos mientras la pestaña está visible. El historial solo cambia cuando el motor termina una comprobación, así que su consulta usa `engine.lastTickAt` como clave y se pide una vez por comprobación.
- **Actualizaciones optimistas.** Reordenar, Usar ahora, habilitar y la configuración actualizan la caché al instante, se deshacen con un aviso si la petición falla y vuelven a pedir los datos al terminar.
- **Presupuesto del bundle.** El JavaScript inicial debe quedar por debajo de 200 kB gzip. Los modales, el gráfico, el arrastre y el menú de idioma son chunks cargados bajo demanda.
- **i18n y temas.** Todo texto está en `i18n/messages/{en,es,pt-BR}.json` (una prueba comprueba que todos los idiomas tienen las mismas claves). Los temas claro y oscuro salen de los tokens de `DESIGN.md`.
- **Accesibilidad.** Soporte completo de teclado, arrastre con teclado, anuncios para lectores de pantalla, contraste WCAG AA en ambos temas, `prefers-reduced-motion`.

## Patrones de diseño

| Patrón | Dónde |
| --- | --- |
| Ports and adapters | interfaces en `application/ports.ts`, implementadas en `infrastructure/` |
| Composition root / inyección de dependencias | `server/container.ts`; las pruebas pasan fakes con `overrides` |
| Repository | `JsonConfigRepository`, `JsonSecretsRepository`, `JsonStateRepository` |
| Casos de uso como funciones | `application/use-cases`: funciones simples sobre un objeto `deps` |
| Política pura | `domain/rotation-policy.ts`: misma entrada, misma elección, probada con tablas |
| Unit of work | un tick del motor edita una copia del estado y la guarda una vez |
| Mapeador de DTO | `server/dto.ts`, el único camino de los datos del servidor al navegador |
| Mutex y debounce | un mutex asíncrono para ticks y mutaciones; `runNow()` agrupa ráfagas |
| Rutas como modales | `components/route-modal.tsx` |
| UI optimista | `useDashboardMutation` en `web/lib/query.ts` |

## Pruebas y calidad

| Nivel | Herramientas | Qué cubre |
| --- | --- | --- |
| Dominio | Vitest | tablas de la política de rotación, reglas de límite y reinicio (100 % de cobertura) |
| Aplicación | Vitest + fakes en memoria | escenarios del motor, sincronización, reglas de renovación, casos de uso |
| Infraestructura | Vitest + carpetas temporales + `fetch` simulado | escrituras atómicas, conservación de claves, migraciones, lectura tolerante |
| Servidor | Vitest + `app.request()` | rutas, validación, protecciones, compresión, DTOs sin secretos |
| Web | Vitest + Testing Library | pantallas, modales, actualizaciones optimistas, paridad de idiomas |
| Punta a punta | Playwright + API de Anthropic falsa | importar, reordenar, cambio automático, volver a subir, errores, accesibilidad (axe) |

Las pruebas nunca tocan los `~/.claude` o `~/.config/claude-swap` reales: apuntan `HOME`, `CLAUDE_CONFIG_DIR` y `CLAUDE_SWAP_HOME` a carpetas temporales y las URLs de Anthropic a un servidor falso. `npm run check` (lint, tipos, pruebas) debe pasar antes de cada commit, y `npm run perf:budget` comprueba el tamaño del bundle y la memoria en reposo.

## Cómo se desarrolló

1. **Primero la especificación.** `docs/architecture.md` describe el objetivo, el runtime, la integración con Claude Code, la estructura y el modelo de seguridad antes de cualquier código.
2. **Tareas pequeñas.** El trabajo se dividió en trece tareas (`docs/tasks/T01`–`T13`): base del proyecto, dominio, persistencia, adapter de Claude Code, cliente de Anthropic, motor, servidor, base de la web, panel, modales, pruebas de punta a punta, despliegue y una revisión final.
3. **Guiado por pruebas.** Cada tarea siguió rojo → verde → refactorizar, y toda corrección de error empieza con una prueba que falla.
4. **Decisiones por escrito.** Todo lo que la especificación no cubría quedó registrado con su motivo en el registro de decisiones (`docs/architecture.md` §9).
5. **Pensado para agentes.** `AGENTS.md` reúne las reglas para cualquier agente de código; un grafo de conocimiento (`graphify`) ayuda a navegar el código.

## Mantener esta página al día

Esta página y el `README.md` describen el sistema tal como es. Un cambio en las tecnologías, la estructura, la API, el motor o los archivos de datos debe actualizar ambos en el mismo cambio (la regla está en `AGENTS.md`). La página no está enlazada en ningún sitio: ábrela escribiendo `/doc-dev`. Sigue el idioma elegido en la app.
