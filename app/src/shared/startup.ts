export function hasHiddenLaunchFlag(argv: readonly string[]): boolean {
  return argv.includes('--hidden')
}
