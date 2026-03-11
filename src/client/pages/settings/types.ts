export type AuthMode = 'none' | 'basic' | 'forms' | 'oidc';

export interface OidcSettingsResponse {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scopes: string[];
}

export interface AuthModeResponse {
  authMode: AuthMode;
  hasAdminUser: boolean;
  oidc: OidcSettingsResponse;
}

export interface ChangeAuthModeResponse {
  success: boolean;
  authMode: AuthMode;
  message: string;
}

export interface AppSettingsResponse {
  validationIntervalMinutes: number;
}

export interface NotificationSettingsResponse {
  slackEnabled: boolean;
  webhookEnabled: boolean;
  defaultWebhookUrl: string;
  defaultSlackToken: string;
  defaultSlackChannel: string;
}

export type NotificationChannel = 'slack' | 'webhook';

export interface ApiKeyResponse {
  id: number;
  name: string;
  maskedKey: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revoked: boolean;
}

export interface RotateResponse {
  id: number;
  name: string;
  apiKey: string;
  maskedKey: string;
  message: string;
  revokedKeyId: number;
}

export interface BackupFileResponse {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
}

export interface BackupSettingsResponse {
  enabled: boolean;
  directory: string;
  retentionCount: number;
  frequency: 'daily';
  lastBackupAt: string | null;
  nextBackupAt: string | null;
  lastError: string | null;
  backups: BackupFileResponse[];
  redactionNotes: string[];
}

export interface BackupMutationResponse extends BackupSettingsResponse {
  success: boolean;
  message: string;
}

export interface BackupCreateResponse {
  success: boolean;
  message: string;
  backup: BackupFileResponse;
}

export interface BackupImportResponse {
  success: boolean;
  message: string;
  restoredAt: string;
  redactedSecretsRequireReentry: boolean;
  redactionNotes: string[];
}