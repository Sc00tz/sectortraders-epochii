CREATE TABLE "limpet_tags" (
	"owner_id" integer NOT NULL,
	"target_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "limpet_tags_owner_id_target_id_pk" PRIMARY KEY("owner_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sector_fighters" (
	"game_id" integer NOT NULL,
	"sector_id" integer NOT NULL,
	"owner_id" integer NOT NULL,
	"count" integer NOT NULL,
	"mode" text NOT NULL,
	CONSTRAINT "sector_fighters_game_id_sector_id_pk" PRIMARY KEY("game_id","sector_id")
);
--> statement-breakpoint
CREATE TABLE "sector_mines" (
	"game_id" integer NOT NULL,
	"sector_id" integer NOT NULL,
	"owner_id" integer NOT NULL,
	"kind" text NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "sector_mines_game_id_sector_id_owner_id_kind_pk" PRIMARY KEY("game_id","sector_id","owner_id","kind")
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "armids" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "limpets" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "prev_sector" integer;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "toll_paid_sector" integer;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "last_read_message_id" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "limpet_tags" ADD CONSTRAINT "limpet_tags_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limpet_tags" ADD CONSTRAINT "limpet_tags_target_id_players_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_fighters" ADD CONSTRAINT "sector_fighters_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_fighters" ADD CONSTRAINT "sector_fighters_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_mines" ADD CONSTRAINT "sector_mines_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_mines" ADD CONSTRAINT "sector_mines_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_player_idx" ON "messages" USING btree ("player_id","id");