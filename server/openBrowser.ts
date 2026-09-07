import { spawn } from 'node:child_process'
import process from 'node:process'

export function commandFor(platform: NodeJS.Platform): string[] {
  if (platform === 'darwin') return ['open']
  if (platform === 'win32') return ['cmd', '/c', 'start', '']
  return ['xdg-open']
}

export async function openBrowser(url: string): Promise<void> {
  const [cmd, ...args] = commandFor(process.platform)
  const child = spawn(cmd, [...args, url], { stdio: 'ignore', detached: true })
  child.unref()
}
