export class AccountNotFoundError extends Error {
  override readonly name = 'AccountNotFoundError'
  constructor(readonly accountId: string) {
    super(`Account not found: ${accountId}`)
  }
}

export class InvalidOrderError extends Error {
  override readonly name = 'InvalidOrderError'
  constructor() {
    super('Order must list every existing account exactly once')
  }
}

export type DomainError = AccountNotFoundError | InvalidOrderError
