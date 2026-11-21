## Visión general

**Claude Swap** mantiene **Claude Code** conectado a la mejor de varias cuentas de Claude (claude.ai).

Agregas tus cuentas y las ordenas por prioridad. Un pequeño servicio en segundo plano mantiene exactamente una de ellas activa en Claude Code y:

- **baja** a la siguiente cuenta cuando la activa alcanza su límite de **5 horas** o **semanal**;
- **vuelve a subir** a una cuenta de mayor prioridad en cuanto su límite se reinicia;
- te permite **cambiar a mano** con **Usar ahora** o reordenando la lista.

Todo se ejecuta en tu equipo: un proceso vinculado a `127.0.0.1`, archivos JSON para el estado, sin base de datos y sin telemetría. Este panel es opcional: el motor sigue funcionando sin ningún navegador abierto.


## Ligero por diseño

Claude Swap existe para simplificar el día a día de quien programa, no para sumar otra cosa que mantener.

- **Nada extra que instalar**: Node.js y la propia aplicación. Sin base de datos, sin Docker, sin colas, sin cuenta en la nube.
- **Un solo proceso pequeño**: el motor, la API y este panel comparten un proceso de Node que usa menos de 100 MB de memoria en reposo.
- **Archivos simples**: la configuración y el estado son archivos JSON que puedes leer (y respaldar) a mano.
- **Solo local**: escucha en `127.0.0.1`, solo habla con los endpoints de Anthropic y no envía telemetría.

Instálalo una vez, agrega tus cuentas y olvídate de él.

## Primeros pasos

1. En una terminal, ejecuta `claude`, luego `/login` e inicia sesión con la primera cuenta.
2. Aquí, haz clic en **Añadir cuenta**, ponle un nombre si quieres y haz clic en **Importar sesión actual**.
3. Repite para cada cuenta que quieras que Claude Swap gestione.
4. Arrastra las cuentas al orden que prefieras. La primera se usa antes.

> Cambia de cuenta en Claude Code con `/login`, **nunca con `/logout`**: cerrar sesión puede revocar el acceso que Claude Swap guarda para esa cuenta.

## El panel

- **Cuenta activa** — la cuenta que Claude Code usa ahora mismo. La pestaña del navegador también muestra su nombre.
- **Próximo reinicio** — cuándo se reinicia la próxima ventana de 5 horas o semanal de cualquier cuenta.
- **Cambios en 24 h** — cuántos cambios automáticos o manuales hubo en el último día.
- **Motor** — *Automático* cambia al alcanzar límites, *Manual* se queda en la primera cuenta, *En pausa* significa que Claude Code está conectado a una cuenta que no está en tu lista.
- **Uso a lo largo del tiempo** — uso de 5 horas de las últimas 24 horas y uso semanal de los últimos 7 días, una línea por cuenta.
- **Cuentas por prioridad** — cada cuenta con sus barras de uso de 5 horas y semanal, horarios de reinicio y estado.

El estado del motor junto al logotipo indica cuándo será la próxima verificación.

## Prioridad y cambios

El orden de la lista **es** la prioridad. La cuenta activa es la primera que:

- está **habilitada**;
- no **necesita volver a iniciar sesión**;
- no **alcanzó un límite**.

Cuando la cuenta activa alcanza un límite, la siguiente cuenta elegible toma el relevo. Cuando la ventana de una cuenta superior se reinicia, Claude Swap vuelve a ella. Si todas las cuentas están en el límite, elige la que se libera primero.

**Usar ahora** mueve una cuenta al primer lugar, lo que la vuelve activa. Arrastrar (con ratón o teclado) y los botones subir/bajar cambian el orden de la misma forma. El interruptor de cada tarjeta desactiva una cuenta sin eliminarla.

## Límites y verificaciones

Cada cuenta tiene dos ventanas de uso, medidas por Anthropic:

| Ventana | Significado |
| --- | --- |
| **5 h** | Límite de sesión móvil de cinco horas |
| **7 d** | Límite semanal |

Una cuenta cuenta como *límite alcanzado* cuando cualquiera de las ventanas está en su umbral o por encima (95 % y 98 % por defecto) y aún no se reinició. Cambiar un poco antes del 100 % evita que un prompt en curso choque con el límite real.

En cada **intervalo de verificación** (3 minutos por defecto) el motor lee el uso de cada cuenta, renueva los tokens de las cuentas inactivas antes de que caduquen y vuelve a elegir la cuenta activa. Cambiar el orden, habilitar una cuenta o hacer clic en **Usar ahora** ejecuta una verificación al instante. El botón **Forzar comprobación** (la flecha circular de la barra superior) hace lo mismo cuando quieras y reinicia la cuenta atrás del intervalo. Si ya hay una verificación en curso, espera a esa en lugar de empezar otra, así nunca se ejecutan dos verificaciones seguidas.

## Configuración

| Opción | Qué hace |
| --- | --- |
| **Tema** | Claro, oscuro o seguir el sistema |
| **Idioma** | English, Español o Português (Brasil) |
| **Cambiar automáticamente** | Desactivado, Claude Code se queda en la primera cuenta hasta que cambies el orden |
| **Límite de 5 horas (%)** | Porcentaje de la ventana de 5 horas que provoca un cambio (50–100) |
| **Límite semanal (%)** | Lo mismo, para la ventana semanal (50–100) |
| **Comprobar cada (segundos)** | Con qué frecuencia se consulta el uso (60–3600) |

## Sesiones abiertas

Un cambio escribe el acceso de la cuenta elegida en los archivos de Claude Code (`~/.claude/.credentials.json` y `~/.claude.json`), conservando todas las demás claves.

- Las **sesiones nuevas** siempre empiezan con la cuenta activa.
- Las **sesiones abiertas** cambian cuando Claude Code vuelve a leer sus credenciales — por ejemplo, al renovar su token o cuando una petición es rechazada. Tu conversación sigue donde estaba.
- Si un prompt alcanza el límite antes del cambio, Claude Code detiene ese turno con un mensaje de límite. Una vez hecho el cambio, envía `continúa` (o repite la petición) en la misma sesión.

Mantener los umbrales por debajo del 100 % hace que el cambio ocurra antes del límite real, así que esto es poco frecuente.

## Solución de problemas

- **Requiere iniciar sesión** — el token guardado dejó de funcionar. Ejecuta `/login` con esa cuenta e impórtala de nuevo.
- **El cambio automático está en pausa** — Claude Code está conectado a una cuenta que no está en tu lista. Impórtala, o haz `/login` con una de las tuyas.
- **La última comprobación del motor falló** — no se pudo leer el uso (red, límite de peticiones). El motor lo reintenta en la próxima verificación.
- **Servidor inaccesible** — el servicio está detenido. Revísalo con `systemctl --user status claude-swap` y mira los registros con `journalctl --user -u claude-swap -f`.

## Privacidad y seguridad

- El servidor solo escucha en `127.0.0.1` y rechaza peticiones de otros sitios.
- Los tokens OAuth se quedan en disco (modo `0600`). Nunca se envían al navegador ni se registran en logs.
- Las únicas llamadas externas van a los endpoints de uso y de tokens de Anthropic. Sin telemetría.
- Los archivos están en `~/.config/claude-swap` (o `$CLAUDE_SWAP_HOME`). Nunca compartas `secrets.json`.

## Sobre mí

Hola, soy **Wesley Silva** (wesleyallan), el desarrollador de Claude Swap.

¡Gracias por usar mi software! Lo creé para dejar de perder el hilo cada vez que se acababa un límite, y espero que a ti también te ahorre ese problema.

Si Claude Swap te ayuda, **dale una ⭐ al proyecto en [GitHub](https://github.com/wesleyallan/claude-swap)**. Ayuda a que otras personas lo encuentren y me motiva a seguir mejorándolo. Los reportes de errores y las ideas también son bienvenidos allí.

Encuéntrame en:

- [GitHub](https://github.com/wesleyallan)
- [LinkedIn](https://www.linkedin.com/in/wesley-silva-229724208/)
- [Instagram](https://www.instagram.com/wesleyallansilva)
- [Facebook](https://facebook.com/wesley.allansilva)
- [Discord](https://discord.gg/hQN2k8N6jf)
- [Correo](mailto:wesley.allansilva@gmail.com)
