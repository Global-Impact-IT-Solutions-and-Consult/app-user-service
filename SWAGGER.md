# Swagger API Documentation

## Overview

This application includes comprehensive Swagger/OpenAPI documentation for all API endpoints. The documentation is automatically generated from the codebase using decorators.

## Accessing the Documentation

Once the application is running, access the Swagger UI at:

```
http://localhost:3000/api/docs
```

## Features

### Interactive API Explorer
- Browse all available endpoints
- View request/response schemas
- Test endpoints directly from the browser
- View example requests and responses

### Authentication

All protected endpoints require JWT authentication:

1. Click the **"Authorize"** button in the Swagger UI
2. Enter your JWT token in the format: `Bearer <your-token>`
3. Click **"Authorize"** to authenticate
4. The token will be used for all subsequent requests

### API Tags

Endpoints are organized into the following tags:

- **auth** - Authentication endpoints (signup, login, MFA)
- **companies** - Company management, API keys, webhooks
- **receipts** - Receipt viewing and management
- **logs** - ElasticSearch log queries

## Usage Example

### 1. User Signup

1. Navigate to `/api/docs`
2. Expand the **auth** tag
3. Find `POST /api/auth/signup`
4. Click **"Try it out"**
5. Enter user details in the request body
6. Click **"Execute"**

### 2. Login and Get Token

1. Use `POST /api/auth/login` to authenticate
2. The response will include MFA requirements
3. Use `POST /api/auth/verify-mfa` to complete authentication
4. Copy the `accessToken` from the response
5. Click **"Authorize"** button and paste the token

### 3. Access Protected Endpoints

Once authorized, you can:
- Create companies
- Manage API keys and webhooks
- Query receipts
- Access logs

## Response Examples

All endpoints include example responses in the documentation showing:
- Success responses with sample data
- Error responses with status codes
- Validation error details

## Request Validation

All request bodies are validated and documented:
- Required fields are marked
- Data types are specified
- Format constraints are documented (email, URL, etc.)
- Example values are provided

## Generating API Client

You can export the OpenAPI specification:

```
GET /api/docs-json
```

This returns the OpenAPI 3.0 JSON specification that can be used with:
- OpenAPI Generator
- Swagger Codegen
- Postman (import collection)
- Insomnia
- Other API client tools

## Decorators Used

The documentation is generated using these NestJS Swagger decorators:

- `@ApiTags()` - Groups endpoints
- `@ApiOperation()` - Endpoint descriptions
- `@ApiResponse()` - Response documentation
- `@ApiProperty()` - Property documentation in DTOs
- `@ApiBearerAuth()` - JWT authentication
- `@ApiParam()` - Path parameter documentation
- `@ApiQuery()` - Query parameter documentation

## Customization

To customize the Swagger configuration, edit `src/main.ts`:

```typescript
const config = new DocumentBuilder()
  .setTitle('User Service API')
  .setDescription('...')
  .setVersion('1.0')
  // ... add more configuration
  .build();
```

## Best Practices

1. Always include descriptions for endpoints and DTOs
2. Provide example values in `@ApiProperty()` decorators
3. Document all possible response codes
4. Use appropriate HTTP status codes
5. Include validation constraints in documentation

