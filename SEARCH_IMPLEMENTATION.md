# MongoDB-Based Flexible Search Implementation

## Overview

I've replaced the external ElasticSearch service with a **MongoDB-based flexible search system** that provides the same functionality - searching and sorting across multiple fields - but using your existing MongoDB database.

## What Changed

### ✅ Removed

- External ElasticSearch service dependency
- `@elastic/elasticsearch` package
- ElasticSearch Docker service
- `elasticsearch.service.ts` file

### ✅ Added

- **Log Schema** (`src/logging/schemas/log.schema.ts`) - MongoDB collection for storing logs
- **Search Service** (`src/logging/search.service.ts`) - Flexible MongoDB-based search
- Enhanced search capabilities with:
  - Multi-field filtering
  - Text search across multiple fields
  - Custom sorting
  - Pagination

## Features

### 1. **Multi-Field Search**

Search across multiple fields simultaneously:

- `companyId` - Filter by company
- `environment` - Filter by test/live
- `receiptId` - Filter by receipt
- `eventType` - Filter by event type
- `processingStage` - Filter by processing stage
- `dateFrom` / `dateTo` - Date range filtering

### 2. **Text Search**

General text search that searches across:

- `eventType`
- `processingStage`
- `message`
- `level`

Example: `?search=receipt` will find all logs containing "receipt" in any of these fields.

### 3. **Flexible Sorting**

Sort by any field in ascending or descending order:

- `sortBy=timestamp` (default)
- `sortBy=eventType`
- `sortBy=processingStage`
- `sortOrder=asc` or `desc` (default: desc)

### 4. **Pagination**

- `page` - Page number (default: 1)
- `limit` - Items per page (default: 50, max: 100)

## API Usage Examples

### Basic Search

```
GET /api/logs?companyId=123&environment=test
```

### Text Search

```
GET /api/logs?search=receipt&environment=test
```

### Date Range + Event Type

```
GET /api/logs?dateFrom=2024-01-01&dateTo=2024-12-31&eventType=receipt.created
```

### Custom Sorting

```
GET /api/logs?sortBy=eventType&sortOrder=asc&limit=20
```

### Combined Filters

```
GET /api/logs?receiptId=456&eventType=receipt.created&dateFrom=2024-01-01&search=error&sortBy=timestamp&sortOrder=desc
```

## Database Schema

The `Log` collection stores:

```typescript
{
  companyId: ObjectId,
  environment: string,
  receiptId?: ObjectId,
  eventType: string,
  processingStage?: string,
  timestamp: Date,
  message?: string,
  level?: string,
  metadata: object,
  data: object
}
```

## Indexes

Optimized indexes for fast queries:

- `companyId`, `environment`, `timestamp` (compound)
- `receiptId`, `timestamp` (compound)
- `eventType`, `timestamp` (compound)
- `companyId`, `environment`, `eventType`, `timestamp` (compound)

## Creating Logs

You can create logs programmatically:

```typescript
await loggingService.createLog({
  companyId: 'company123',
  environment: 'test',
  receiptId: 'receipt456',
  eventType: 'receipt.created',
  processingStage: 'processing',
  message: 'Receipt processed successfully',
  level: 'info',
  metadata: { userId: 'user789' },
  data: { amount: 100 },
});
```

## Benefits

1. **No External Dependencies** - Everything runs in MongoDB
2. **Simpler Architecture** - One less service to manage
3. **Same Functionality** - All search features preserved
4. **Better Integration** - Logs stored with your other data
5. **Easier Deployment** - No ElasticSearch setup needed

## Migration Notes

- All existing API endpoints remain the same
- No changes needed to frontend code
- Logs are now stored in MongoDB instead of ElasticSearch
- You can write logs directly to MongoDB using the `createLog` method

## Next Steps

1. **Remove ElasticSearch dependency** (already done):

   ```bash
   npm uninstall @elastic/elasticsearch
   ```

2. **Update your log writing code** to use the new service:

   ```typescript
   // Instead of writing to ElasticSearch
   // Use: loggingService.createLog({ ... })
   ```

3. **Test the search functionality**:
   - Create some test logs
   - Try different search queries
   - Verify sorting and pagination work correctly

The search system is now fully integrated into your MongoDB database! 🎉
