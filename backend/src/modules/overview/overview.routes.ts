import { Router, type RequestHandler } from "express";
import { sendSuccess } from "../../core/response.js";
import { BadRequestError, UnauthorizedError } from "../../core/errors.js";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import type { Window } from "./overview.repository.js";
import * as service from "./overview.service.js";

/**
 * The dashboard summary.
 *
 * `manager` and above, because the order desk lives on this screen — the call
 * list and the parcels that stopped moving are their work. The takings are
 * withheld from them inside the service rather than by this guard, so one route
 * can serve both roles without a second endpoint that would drift from it.
 */
export const overviewAdminRouter: Router = Router();

overviewAdminRouter.use(authenticate, requireRole("manager"));

/** Before the shop existed. The floor for "all time". */
const EPOCH = new Date("2000-01-01T00:00:00Z");

/**
 * The requested window, as a half-open interval.
 *
 * The panel sends instants carrying Dhaka's offset — `2026-08-30T00:00:00+06:00`
 * — rather than bare dates, because a bare date is read as UTC and a Dhaka day
 * begins at 18:00 UTC the day before. Every order placed between midnight and
 * six in the morning would fall outside "today", which on a shop taking evening
 * orders is a real slice of the day going missing with nothing to show it had.
 *
 * `dateTo` arrives inclusive (`23:59:59.999`) because that is what the order
 * list takes, and one millisecond turns it into the exclusive bound every query
 * downstream is written against. Both halves are optional so an unfiltered
 * "all time" needs no special case.
 */
function toWindow(query: { dateFrom?: unknown; dateTo?: unknown }): Window {
  const parse = (value: unknown, field: string): Date | null => {
    if (typeof value !== "string" || value === "") return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestError(`${field} is not a date this understands.`);
    }
    return parsed;
  };

  const from = parse(query.dateFrom, "dateFrom") ?? EPOCH;
  const to = parse(query.dateTo, "dateTo");

  const window: Window = {
    from,
    /* Now, not the end of today: a range that runs into the future would make
       the comparison window overlap the current one. */
    to: to ? new Date(to.getTime() + 1) : new Date(),
  };

  if (window.to <= window.from) {
    throw new BadRequestError("The range ends before it starts.");
  }

  return window;
}

const summary: RequestHandler = async (req, res) => {
  if (!req.auth) throw new UnauthorizedError();
  const overview = await service.summary(req.auth.role, toWindow(req.query));
  sendSuccess(res, { overview });
};

overviewAdminRouter.get("/", summary);
