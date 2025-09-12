import { Pool, QueryResult } from "pg";

// Create a shared PostgreSQL client pool for app database operations
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/mastra",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Helper function for executing queries
export async function query(text: string, params?: any[]): Promise<QueryResult> {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Database query executed', { text, duration, rows: result.rowCount });
    return result;
  } catch (error) {
    console.error('Database query error', { text, error });
    throw error;
  }
}

// Get a client from the pool for transactions
export function getClient() {
  return pool.connect();
}

// Close the pool (useful for cleanup)
export function end() {
  return pool.end();
}

export default { query, getClient, end };