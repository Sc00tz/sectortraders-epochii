-- Our own names for the special ports in galaxies made before the rename. Only the display name changes.
UPDATE "ports" SET "name" = 'Keystone Station' WHERE "cls" = 9 AND "name" = 'Stardock';--> statement-breakpoint
UPDATE "ports" SET "name" = 'Cradle Depot' WHERE "cls" = 0 AND "name" = 'Home Depot';--> statement-breakpoint
UPDATE "ports" SET "name" = 'Deepstone Depot' WHERE "cls" = 0 AND "name" = 'Outer Depot';--> statement-breakpoint
UPDATE "ports" SET "name" = 'Ringwall Depot' WHERE "cls" = 0 AND "name" = 'Frontier Depot';
