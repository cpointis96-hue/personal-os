import Database from "@tauri-apps/plugin-sql";

let _db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load("sqlite:personal-os.db");
  }
  return _db;
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  return db.select<T[]>(sql, params);
}

export async function run(sql: string, params: unknown[] = []): Promise<void> {
  const db = await getDb();
  await db.execute(sql, params);
}

export async function runGetId(sql: string, params: unknown[] = []): Promise<number> {
  const db = await getDb();
  const result = await db.execute(sql, params);
  return result.lastInsertId ?? 0;
}
