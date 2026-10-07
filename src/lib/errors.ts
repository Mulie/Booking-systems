export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
