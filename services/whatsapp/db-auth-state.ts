import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { prisma } from "../../lib/prisma";

/**
 * Postgres-backed Baileys auth-state adapter.
 *
 * Why: hosts like Koyeb / Render / Vercel give us no persistent disk on
 * their free tiers, which would force WhatsApp re-pairing on every
 * container restart. Persisting the Signal protocol state in Postgres
 * (which we already have for everything else) sidesteps the problem.
 *
 * Wire-compatible with `useMultiFileAuthState`. Each "file" Baileys would
 * have written is one row in the `WhatsAppAuth` table, keyed by
 * "<namespace>/<filename>". Buffers in the auth state round-trip via
 * Baileys' own `BufferJSON` replacer/reviver.
 *
 * Keep one logical store per worker (singleton). Multi-account support
 * later just means changing `NAMESPACE` per logical account.
 */

const NAMESPACE = process.env.WA_AUTH_NAMESPACE || "default";

interface DBAuthState {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  /** Wipe everything in this namespace — used by manual logout. */
  clearAll: () => Promise<void>;
}

export async function useDBAuthState(): Promise<DBAuthState> {
  const fullKey = (file: string) => `${NAMESPACE}/${file}`;

  const writeData = async (data: unknown, file: string): Promise<void> => {
    const value = JSON.stringify(data, BufferJSON.replacer);
    await prisma.whatsAppAuth.upsert({
      where: { key: fullKey(file) },
      update: { value },
      create: { key: fullKey(file), value },
    });
  };

  const readData = async (file: string): Promise<unknown | null> => {
    const row = await prisma.whatsAppAuth.findUnique({
      where: { key: fullKey(file) },
    });
    if (!row) return null;
    try {
      return JSON.parse(row.value, BufferJSON.reviver);
    } catch {
      return null;
    }
  };

  const removeData = async (file: string): Promise<void> => {
    await prisma.whatsAppAuth
      .delete({ where: { key: fullKey(file) } })
      .catch(() => undefined);
  };

  // Bootstrap creds: load from DB or initialize fresh.
  const stored = (await readData("creds")) as AuthenticationCreds | null;
  const creds: AuthenticationCreds = stored ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[]
        ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = (await readData(`${type}-${id}`)) as
                | SignalDataTypeMap[T]
                | null;
              if (type === "app-state-sync-key" && value) {
                // Baileys requires re-hydration of this proto type.
                value = proto.Message.AppStateSyncKeyData.fromObject(
                  value as object
                ) as unknown as SignalDataTypeMap[T];
              }
              if (value) data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks: Promise<unknown>[] = [];
          for (const category of Object.keys(data)) {
            const dict = (data as Record<string, Record<string, unknown>>)[
              category
            ];
            for (const id of Object.keys(dict)) {
              const value = dict[id];
              const file = `${category}-${id}`;
              tasks.push(value ? writeData(value, file) : removeData(file));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await writeData(creds, "creds");
    },
    clearAll: async () => {
      await prisma.whatsAppAuth.deleteMany({
        where: { key: { startsWith: `${NAMESPACE}/` } },
      });
    },
  };
}
