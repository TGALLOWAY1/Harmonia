-- CreateTable
CREATE TABLE "CardTemplate" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "optionA" TEXT NOT NULL,
    "optionB" TEXT NOT NULL,
    "optionC" TEXT NOT NULL,
    "optionD" TEXT NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "meta" JSONB,
    "milestoneKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardState" (
    "id" SERIAL NOT NULL,
    "cardId" INTEGER NOT NULL,
    "attemptsCount" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "lastAnswerAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardAttempt" (
    "id" SERIAL NOT NULL,
    "cardId" INTEGER NOT NULL,
    "selectedIndex" INTEGER NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "responseMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "isUnlocked" BOOLEAN NOT NULL DEFAULT false,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0.0,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardTemplate_slug_key" ON "CardTemplate"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_key_key" ON "Milestone"("key");

-- CreateIndex
CREATE INDEX "Milestone_order_idx" ON "Milestone"("order");

-- AddForeignKey
ALTER TABLE "CardState" ADD CONSTRAINT "CardState_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CardTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAttempt" ADD CONSTRAINT "CardAttempt_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CardTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
