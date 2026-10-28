// Adapts Durable Object SQLite (ctx.storage.sql.exec, synchronous) to the small node:sqlite-like surface StoreCore uses.
export function durableSql(sql) {
  const run = (query, args) => sql.exec(query, ...args.map(value => (value === undefined ? null : value)));
  return {
    exec(query) { sql.exec(query); },
    prepare(query) {
      return {
        get: (...args) => run(query, args).toArray()[0],
        all: (...args) => run(query, args).toArray(),
        run: (...args) => { const cursor = run(query, args); cursor.toArray(); return { changes: cursor.rowsWritten }; },
      };
    },
    close() {},
  };
}
