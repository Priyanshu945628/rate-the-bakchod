import "server-only";

/**
 * Local-disk storage adapter.
 *
 * Stands in for Internet Archive when STORAGE_DRIVER=disk, so the app is fully
 * runnable offline and the test suite never touches the network. It stores the
 * same ciphertext the archive adapter would, under `.storage/<item>/<file>`.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { serverEnv } from "../config";
import type { PutOptions, StorageAdapter, StoredLocator } from "./index";

const ROOT = path.join(serverEnv.dataDir, ".storage");

function itemIdFor(date: Date): string {
  return `local-${date.toISOString().slice(0, 10).replace(/-/g, "")}`;
}

export class LocalDiskAdapter implements StorageAdapter {
  readonly name = "local-disk";

  private pathFor(locator: StoredLocator): string {
    // Guard against traversal via a crafted key.
    const item = path.basename(locator.item);
    const file = path.basename(locator.file);
    return path.join(ROOT, item, file);
  }

  async put(key: string, data: Buffer, _opts: PutOptions): Promise<StoredLocator> {
    const locator: StoredLocator = { item: itemIdFor(new Date()), file: `${key}.enc` };
    const dest = this.pathFor(locator);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, data);
    return locator;
  }

  async get(locator: StoredLocator): Promise<Buffer> {
    return readFile(this.pathFor(locator));
  }

  async head(locator: StoredLocator): Promise<boolean> {
    try {
      await stat(this.pathFor(locator));
      return true;
    } catch {
      return false;
    }
  }
}
