import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./customer.controller.js";
import {
  exportCustomersQuerySchema,
  listCustomersQuerySchema,
} from "./customer.validation.js";

/**
 * Customers.
 *
 * `manager` and above. This is the order desk's screen — the phone number they
 * call and the return history that decides whether to confirm a suspicious
 * order — and locking it to `admin` would put it out of reach of the people who
 * actually use it.
 *
 * It carries no commercial figures beyond what the orders list already shows
 * that same role: `spent` is the sum of totals a manager can already read
 * order by order. Cost and margin stay in the reports module at `admin`.
 */
export const customerAdminRouter: Router = Router();

customerAdminRouter.use(authenticate, requireRole("manager"));

customerAdminRouter.get(
  "/",
  validate({ query: listCustomersQuerySchema }),
  controller.list,
);

/* Declared before nothing in particular, but kept above any future `/:phone`
   route: a literal path must be matched before a parameter that could swallow
   it. */
customerAdminRouter.get(
  "/export",
  validate({ query: exportCustomersQuerySchema }),
  controller.export,
);
