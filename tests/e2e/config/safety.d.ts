export interface E2eSafetyConfig {
  readonly databaseUrl: string | undefined;
  readonly serverPort: number;
  readonly clientPort: number;
}

export function validateE2eSafety(config: E2eSafetyConfig): {
  readonly serverPort: number;
  readonly clientPort: number;
};
