-- Who a coupon was made for, when it was not made for a lead.
--
-- Coupons can now be minted from the Coupons page with no abandoned checkout
-- behind them — for a customer the desk is talking to on the phone who was
-- never in the call list. The column the lead would have provided (a name, a
-- number) is absent for those, and without something in its place the list is a
-- column of anonymous six-character codes that answers nothing.
--
-- Free text on purpose. "Rahim, phone order" and "Facebook page, blue lamp" are
-- both the right answer, and a shop that has to pick from a dropdown writes
-- whatever is nearest instead of what happened.
--
-- Empty for every coupon issued from a lead: those already know whose they are.
--
-- Additive only.
ALTER TABLE "recovery_coupons"
  ADD COLUMN IF NOT EXISTS "note" text NOT NULL DEFAULT '';
