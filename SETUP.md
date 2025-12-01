# Setup Guide

## Initial Setup

1. **Install Dependencies**
```bash
yarn install
```

2. **Environment Configuration**
```bash
cp ENV.example .env
```

Edit `.env` file with your configuration:
- Generate a strong `JWT_SECRET` (minimum 32 characters)
- Generate a strong `ENCRYPTION_KEY` (32 characters)
- Configure MongoDB URI
- Configure ElasticSearch node URL
- Configure Receipt Service URL

3. **Start Services**

Using Docker Compose (Recommended):
```bash
docker-compose up -d
```

Or start services manually:
- MongoDB on port 27017
- ElasticSearch on port 9200

4. **Run Application**
```bash
yarn start:dev
```

## Database Setup

MongoDB will automatically create databases and collections on first use. No manual migration needed.

## ElasticSearch Setup

ElasticSearch indices will be created automatically when logs are written. The service queries the `user-service-logs-*` index pattern.

## Testing the API

### 1. Signup
```bash
POST /api/auth/signup
{
  "email": "user@example.com",
  "password": "Password123",
  "firstName": "John",
  "lastName": "Doe"
}
```

### 2. Login (returns MFA requirement)
```bash
POST /api/auth/login
{
  "email": "user@example.com",
  "password": "Password123"
}
```

### 3. Verify MFA
```bash
POST /api/auth/verify-mfa
{
  "userId": "<userId>",
  "code": "123456"
}
```

### 4. Create Company
```bash
POST /api/companies
Authorization: Bearer <token>
{
  "name": "My Company",
  "legalName": "My Company Inc.",
  "taxId": "123456789"
}
```

### 5. Get API Keys
```bash
GET /api/companies/:companyId/api-keys
Authorization: Bearer <token>
```

## Security Notes

- **JWT_SECRET**: Must be changed in production
- **ENCRYPTION_KEY**: Must be changed in production and kept secure
- **MongoDB**: Should use authentication in production
- **ElasticSearch**: Should enable security in production
- **CORS**: Configure `ALLOWED_ORIGINS` properly in production

## Production Checklist

- [ ] Change JWT_SECRET
- [ ] Change ENCRYPTION_KEY
- [ ] Enable MongoDB authentication
- [ ] Enable ElasticSearch security
- [ ] Configure CORS properly
- [ ] Set up SSL/TLS
- [ ] Configure proper logging
- [ ] Set up monitoring
- [ ] Configure backup strategy
- [ ] Review rate limiting settings

