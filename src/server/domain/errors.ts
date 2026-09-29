// Типизированные ошибки доменного слоя; HTTP-статус выбирается по типу, текст показывается пользователю.
export class DomainError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 422, readonly code: string) {
    super(message);
  }
}
export const businessRule = (message: string) => new DomainError(message, 400, 'business_rule');
export const forbidden = (message = 'Недостаточно прав') => new DomainError(message, 403, 'forbidden');
export const notFound = (message: string) => new DomainError(message, 404, 'not_found');
export const conflict = (message: string) => new DomainError(message, 409, 'conflict');
export const invalid = (message: string) => new DomainError(message, 422, 'validation');
