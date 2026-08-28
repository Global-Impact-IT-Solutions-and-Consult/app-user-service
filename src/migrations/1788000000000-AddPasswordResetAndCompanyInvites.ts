import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordResetAndCompanyInvites1788000000000
  implements MigrationInterface
{
  name = 'AddPasswordResetAndCompanyInvites1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "passwordResetTokenHash" character varying,
        ADD COLUMN IF NOT EXISTS "passwordResetExpiresAt" TIMESTAMP
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "company_invites_status_enum" AS ENUM ('pending', 'accepted', 'revoked', 'expired');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "company_invites" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "companyId" uuid NOT NULL,
        "email" character varying NOT NULL,
        "role" character varying NOT NULL DEFAULT 'member',
        "tokenHash" character varying NOT NULL,
        "invitedBy" uuid,
        "status" "company_invites_status_enum" NOT NULL DEFAULT 'pending',
        "expiresAt" TIMESTAMP NOT NULL,
        "acceptedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_company_invites" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_company_invites_companyId" ON "company_invites" ("companyId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_company_invites_email" ON "company_invites" ("email")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_company_invites_tokenHash" ON "company_invites" ("tokenHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_users_passwordResetTokenHash" ON "users" ("passwordResetTokenHash")`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "company_invites"
          ADD CONSTRAINT "FK_company_invites_company"
          FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "company_invites"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "company_invites_status_enum"`);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "passwordResetExpiresAt",
        DROP COLUMN IF EXISTS "passwordResetTokenHash"
    `);
  }
}
