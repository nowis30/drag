import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// These root files are the source of truth for both the website and Capacitor.
const files = ['index.html', 'main.js', 'style.css'];
const root = new URL('../', import.meta.url);
const output = new URL('www/', root);
const check = process.argv.includes('--check');

if (!check) await mkdir(output, { recursive: true });
for (const file of files) {
  const source = await readFile(new URL(file, root));
  const destination = new URL(file, output);
  if (check) {
    const built = await readFile(destination).catch(() => null);
    if (!built || !source.equals(built)) {
      throw new Error(`${fileURLToPath(destination)} is stale. Run npm run build.`);
    }
  } else {
    await writeFile(destination, source);
  }
}
console.log(check ? 'Web distribution matches the source.' : 'Web distribution synchronized.');
