// Entry point to start the standalone Arabic Cinema Bot
import dotenv from 'dotenv';
import { startCinemaBot } from './bot/standalone-bot';

// Load environment variables
dotenv.config();

// Validate required environment variables
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN is required but not found in environment variables');
  process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY is required but not found in environment variables');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is required but not found in environment variables');
  process.exit(1);
}

// Start the bot
console.log('🚀 Initializing Arabic Cinema Bot...');
console.log('🔑 Environment variables validated');
console.log('🎬 Starting bot services...');

try {
  startCinemaBot();
} catch (error) {
  console.error('❌ Failed to start cinema bot:', error);
  process.exit(1);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM. Shutting down gracefully...');
  process.exit(0);
});