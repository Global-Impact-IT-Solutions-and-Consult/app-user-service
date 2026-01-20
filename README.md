<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

User Service - A comprehensive authentication and business management service built with NestJS and MongoDB. This service handles user authentication with mandatory MFA, company onboarding, API key management, webhook management, receipt viewing, and ElasticSearch logging integration.

## Features

- **User Authentication Flow**
  - Email/password login with mandatory MFA (TOTP)
  - JWT tokens with environment scope (Test/Live)
  - Environment switching in dashboard
  - Account lockout after failed attempts

- **Business Onboarding Flow**
  - User signup with MFA setup
  - Company profile creation
  - Onboarding steps tracking
  - Automatic API key generation (Test immediately, Live after approval)
  - Webhook management with signing secrets

- **Receipt Viewing Flow**
  - Query receipts by date range
  - Download receipts in various formats
  - View receipt status
  - Access event logs from ElasticSearch

- **Logging System**
  - Direct ElasticSearch integration
  - Paginated log results
  - Filtering by event type, date range, receipt ID, processing stage, company ID, and environment

## Technology Stack

- **Framework**: NestJS 11
- **Database**: PostgreSQL 16 with TypeORM
- **Authentication**: JWT, Passport.js, TOTP (OTPLIB)
- **Validation**: class-validator, class-transformer
- **Security**: bcrypt, encryption utilities, rate limiting
- **Containerization**: Docker & Docker Compose

## Project Setup

### Prerequisites

- Node.js 20+ (or Docker & Docker Compose)
- PostgreSQL 16+ (or use Docker Compose)
- Docker & Docker Compose (recommended for easy setup)

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd app-user-service
```

2. **Install dependencies**
```bash
yarn install
```

3. **Setup environment variables**

Copy `ENV.example` to `.env` and configure:

```bash
cp ENV.example .env
```

Edit `.env` with your configuration:
- `JWT_SECRET`: Strong secret for JWT signing
- `ENCRYPTION_KEY`: 32-character key for API/webhook secret encryption
- `DB_HOST`: PostgreSQL host (use `postgres` when using Docker Compose)
- `DB_PORT`: PostgreSQL port (5432 in Docker, 5433 for local)
- `DB_USERNAME`: PostgreSQL username
- `DB_PASSWORD`: PostgreSQL password
- `DB_DATABASE`: Database name
- `RECEIPT_SERVICE_URL`: Receipt service API URL
- `SMTP_*`: Email configuration for OTP sending

4. **Start services with Docker Compose** (Recommended)

**Production:**
```bash
docker-compose up -d
```

**Development (with hot reload):**
```bash
docker-compose -f docker-compose.dev.yml up
```

This will start:
- PostgreSQL on port 5433 (or as configured in `.env`)
- User Service on port 3000

The production setup includes:
- Multi-stage Docker build for optimized image size
- Health checks for both app and database
- Automatic restart policies
- Isolated Docker network
- Persistent database volume

**Docker Commands:**

```bash
# Build and start services
docker-compose up -d

# View logs
docker-compose logs -f app-user-service

# Stop services
docker-compose down

# Stop and remove volumes (⚠️ deletes database data)
docker-compose down -v

# Rebuild after code changes
docker-compose up -d --build

# Access PostgreSQL directly
docker-compose exec postgres psql -U postgres -d user-service
```

**Local Development (App runs locally, PostgreSQL in Docker):**

```bash
# Start only PostgreSQL in Docker
docker-compose -f docker-compose.local.yml up -d

# Make sure your .env file has:
# DB_HOST=localhost
# DB_PORT=5433
# DB_USERNAME=postgres
# DB_PASSWORD=postgres
# DB_DATABASE=user-service

# Then run the app locally
yarn start:dev
```

Or start services manually:

```bash
# Start PostgreSQL (if running locally)
# Make sure PostgreSQL is running on the configured port

# Start the application
yarn start:dev
```

## Running the Application

```bash
# Development (with hot reload)
yarn start:dev

# Production build
yarn build
yarn start:prod

# Debug mode
yarn start:debug
```

The API will be available at `http://localhost:3000/api`

### Swagger Documentation

Once the application is running, you can access the interactive Swagger documentation at:

```
http://localhost:3000/api/docs
```

The Swagger UI provides:
- Complete API endpoint documentation
- Request/response schemas
- Try-it-out functionality
- Authentication support (JWT Bearer token)

To use the API through Swagger:
1. Navigate to `/api/docs`
2. Use the "Authorize" button to enter your JWT token
3. Test endpoints directly from the browser

## API Endpoints

### Authentication
- `POST /api/auth/signup` - User registration
- `POST /api/auth/login` - User login (triggers MFA)
- `POST /api/auth/verify-mfa` - Verify MFA code
- `POST /api/auth/switch-environment` - Switch between Test/Live environments
- `GET /api/auth/me` - Get current user profile

### Companies
- `POST /api/companies` - Create company
- `GET /api/companies` - Get user's companies
- `GET /api/companies/:id` - Get company details
- `PUT /api/companies/:id/onboarding/:step` - Update onboarding step
- `GET /api/companies/:id/api-keys` - Get API keys
- `DELETE /api/companies/:id/api-keys/:keyId` - Revoke API key

### Webhooks
- `POST /api/companies/:id/webhooks` - Create webhook
- `GET /api/companies/:id/webhooks` - Get webhooks
- `PUT /api/companies/:id/webhooks/:webhookId` - Update webhook
- `DELETE /api/companies/:id/webhooks/:webhookId` - Delete webhook
- `POST /api/companies/:id/webhooks/:webhookId/test` - Test webhook
- `POST /api/companies/:id/webhooks/:webhookId/regenerate-secret` - Regenerate webhook secret

### Receipts
- `GET /api/receipts` - Query receipts (with date filters)
- `GET /api/receipts/:id` - Get receipt details
- `GET /api/receipts/:id/status` - Get receipt status
- `GET /api/receipts/:id/download` - Download receipt
- `GET /api/receipts/:id/logs` - Get receipt logs from ElasticSearch

### Logs
- `GET /api/logs` - Query logs with filters (company, environment, receipt, event type, date range)

## Run tests

```bash
# unit tests
$ yarn run test

# e2e tests
$ yarn run test:e2e

# test coverage
$ yarn run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ yarn install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
