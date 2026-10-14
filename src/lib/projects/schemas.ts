import { z } from "zod";
import { dateKeySchema } from "@/lib/dates";
import { PROJECT_STATUSES } from "./types";

export const MAX_PROJECT_NAME = 120;
export const MAX_PROJECT_DESCRIPTION = 10_000;
export const MAX_MILESTONE_TITLE = 160;

const name = z.string().trim().min(1, "Give the project a name").max(MAX_PROJECT_NAME);

export const createProjectSchema = z.object({
  name,
  description: z.string().max(MAX_PROJECT_DESCRIPTION).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  dueDate: dateKeySchema.nullable().optional(),
});

export const updateProjectSchema = z.object({
  name: name.optional(),
  description: z.string().max(MAX_PROJECT_DESCRIPTION).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  dueDate: dateKeySchema.nullable().optional(),
});

const milestoneTitle = z.string().trim().min(1, "Give the milestone a title").max(MAX_MILESTONE_TITLE);

export const createMilestoneSchema = z.object({
  title: milestoneTitle,
  dueDate: dateKeySchema.nullable().optional(),
});

export const updateMilestoneSchema = z.object({
  title: milestoneTitle.optional(),
  dueDate: dateKeySchema.nullable().optional(),
  completed: z.boolean().optional(),
});
