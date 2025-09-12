# Cinema Bot Agent System

## Overview

This is a comprehensive cinema bot system built with the Mastra framework that manages movie, series, and anime content through AI agents. The system features dynamic content management, multi-language support (English/Arabic), user role management, and integrations with Slack and Telegram for bot interactions. It uses PostgreSQL for data persistence and includes sophisticated permission management for admin operations.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Core Framework
- **Mastra Framework**: Primary framework for AI agent orchestration and workflow management
- **TypeScript/Node.js**: Runtime environment with ES2022 module system
- **Inngest**: Event-driven workflow engine for handling asynchronous operations and triggers

### Agent Architecture
- **Dynamic Agents**: Configurable AI agents that adapt behavior based on runtime context (user tier, language preferences, permissions)
- **Multi-Model Support**: Integration with OpenAI GPT models, Google AI, and OpenRouter for flexible AI capabilities
- **Tool-Based Operations**: Modular tool system for content management operations (add, edit, delete, list content)
- **Runtime Context**: Dynamic instruction and model selection based on user attributes and operational context

### Data Layer
- **PostgreSQL Database**: Primary data store for content, users, permissions, and activity logs
- **Connection Pool**: Shared connection pool for efficient database operations
- **Transaction Support**: Atomic operations for complex admin operations
- **Mastra Storage Integration**: PostgreSQL-based storage for agent state and workflow data

### Authentication & Authorization
- **Role-Based Access Control**: Three-tier system (user, admin, owner)
- **Granular Permissions**: Fine-grained permissions for specific operations (CONTENT_ADD, CONTENT_EDIT, CONTENT_DELETE, MANAGE_CONTENT)
- **User Validation**: Comprehensive user authentication with ban checking and permission validation
- **Activity Logging**: Audit trail for all administrative actions

### Content Management
- **Multi-Section Support**: Movies, Series, Anime, Documentaries with bilingual metadata
- **Rich Metadata**: Comprehensive content attributes including ratings, quality, premium status, trending flags
- **Soft Delete**: Safe content removal with dependency checking
- **Search & Filtering**: Advanced content discovery with pagination support

### Bot Integrations
- **Slack Integration**: Webhook-based message processing with channel-specific handling
- **Telegram Integration**: Bot API integration for direct message interactions
- **Multi-Platform Support**: Unified trigger system for cross-platform message handling

### Admin Management
- **Admin Creation/Removal**: Owner-controlled admin user management
- **Permission Management**: Dynamic permission granting and revocation
- **Command Toggle System**: Runtime enable/disable of bot commands by role
- **Admin Listing**: Comprehensive admin oversight with pagination and filtering

### Development & Deployment
- **Development Mode**: Local development server with hot reloading and telemetry
- **Production Ready**: Configurable for production deployment with proper logging
- **Playground Interface**: Built-in development interface for testing and debugging
- **TypeScript Build System**: Strict typing with comprehensive error checking

## External Dependencies

### AI Services
- **OpenAI**: Primary LLM provider for GPT-3.5-turbo and GPT-4 models
- **Google AI (Gemini)**: Alternative AI model provider for enhanced capabilities
- **OpenRouter**: Multi-model AI provider for additional model access

### Database & Storage
- **PostgreSQL**: Primary database for all application data
- **Mastra PostgreSQL Store**: Integrated storage solution for agent workflows and state management

### Communication Platforms
- **Slack Web API**: Real-time messaging and webhook integration for team communications
- **Telegram Bot API**: Direct user interaction through Telegram messaging

### Development & Monitoring
- **Inngest**: Workflow orchestration and event processing engine
- **Pino Logger**: High-performance logging with structured output
- **OpenTelemetry**: Observability and distributed tracing (configured for production)

### Utilities & Tools
- **Exa**: Search API integration for enhanced content discovery
- **Zod**: Runtime type validation and schema definition
- **dotenv**: Environment variable management for configuration