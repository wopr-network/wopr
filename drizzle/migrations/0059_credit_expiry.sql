ALTER TABLE "credit_transactions" ADD COLUMN "expires_at" text;
--> statement-breakpoint
CREATE INDEX "idx_credit_tx_expires" ON "credit_transactions" USING btree ("expires_at");
