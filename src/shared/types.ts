/** Types shared between server and client */

export interface HealthResponse {
  status: 'ok' | 'error';
  version: string;
}

export interface ApiErrorResponse {
  error: {
    message: string;
    code: string;
  };
}
