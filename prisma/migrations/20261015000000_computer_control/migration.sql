-- Whether agents may use this computer (run commands, read and write files). Off until the owner turns it on.
ALTER TABLE "AppSettings" ADD COLUMN "computerControl" BOOLEAN NOT NULL DEFAULT false;
