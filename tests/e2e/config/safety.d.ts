export interface E2eSafetyConfig {
  readonly databaseUrl: string | undefined;
  readonly serverPort: number;
  readonly clientPort: number;
}

export function validateDedicatedE2eDatabaseUrl(databaseUrl: string | undefined): string;

export function createDedicatedE2ePool<T>(
  databaseUrl: string | undefined,
  PoolClass: new (options: { readonly connectionString: string; readonly max: number }) => T,
): T;

export function validateE2eSafety(config: E2eSafetyConfig): {
  readonly serverPort: number;
  readonly clientPort: number;
};
