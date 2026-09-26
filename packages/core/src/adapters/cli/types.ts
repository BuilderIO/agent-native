export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CliAdapter {
  name: string;

  description: string;

  isAvailable(): Promise<boolean>;

  execute(args: string[]): Promise<CliResult>;
}
