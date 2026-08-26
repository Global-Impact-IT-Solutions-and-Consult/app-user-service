import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompanyProfileAndManualInvoiceFields1787702400000
  implements MigrationInterface
{
  name = 'AddCompanyProfileAndManualInvoiceFields1787702400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
        ADD COLUMN IF NOT EXISTS "businessType" character varying,
        ADD COLUMN IF NOT EXISTS "industry" character varying,
        ADD COLUMN IF NOT EXISTS "registeredAddress" text,
        ADD COLUMN IF NOT EXISTS "contactPhone" character varying,
        ADD COLUMN IF NOT EXISTS "contactPerson" character varying,
        ADD COLUMN IF NOT EXISTS "contactEmail" character varying
    `);

    await queryRunner.query(`
      ALTER TABLE "invoices"
        ADD COLUMN IF NOT EXISTS "dueDate" date,
        ADD COLUMN IF NOT EXISTS "buyerEmail" character varying,
        ADD COLUMN IF NOT EXISTS "buyerPhone" character varying,
        ADD COLUMN IF NOT EXISTS "notes" text,
        ADD COLUMN IF NOT EXISTS "sentAt" timestamp
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "invoices"
        DROP COLUMN IF EXISTS "sentAt",
        DROP COLUMN IF EXISTS "notes",
        DROP COLUMN IF EXISTS "buyerPhone",
        DROP COLUMN IF EXISTS "buyerEmail",
        DROP COLUMN IF EXISTS "dueDate"
    `);

    await queryRunner.query(`
      ALTER TABLE "companies"
        DROP COLUMN IF EXISTS "contactEmail",
        DROP COLUMN IF EXISTS "contactPerson",
        DROP COLUMN IF EXISTS "contactPhone",
        DROP COLUMN IF EXISTS "registeredAddress",
        DROP COLUMN IF EXISTS "industry",
        DROP COLUMN IF EXISTS "businessType"
    `);
  }
}
