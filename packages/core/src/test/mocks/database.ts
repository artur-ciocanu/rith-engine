import { mock, type Mock } from 'bun:test';
import type { QueryResult } from '../../db/adapters/types';
import { sqliteDialect } from '../../db/adapters/sqlite';

export interface MockPool {
  query: Mock<(...args: unknown[]) => Promise<QueryResult<unknown>>>;
}

export const createMockPool = (): MockPool => ({
  query: mock(() => Promise.resolve(createQueryResult([]))),
});

export const mockPool = createMockPool();

export const resetMockPool = (): void => {
  mockPool.query.mockReset();
};

// Helper to create mock query results matching the IDatabase QueryResult shape.
export const createQueryResult = <T>(rows: T[], rowCount?: number): QueryResult<T> => ({
  rows,
  rowCount: rowCount ?? rows.length,
});

// Tests mock `getDialect` to return the real SQLite dialect, so SQL assertions
// reflect exactly what production emits (SQLite is the only backend).
export const mockSqliteDialect = sqliteDialect;
