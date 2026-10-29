# NAHE — Project Guidelines

## Project

Nahe is a private event management application.
Users can view events, reserve places and pay
using Wero or PayPal.

## Tech Stack

- React + Vite + TypeScript
- Tailwind CSS
- Cloudflare Workers
- Cloudflare D1
- Drizzle ORM
- Zod

## Architecture

- Keep frontend and backend concerns separated.
- Use reusable components.
- Keep business logic out of UI components.
- Validate all API inputs server-side.
- Use strict TypeScript.
- Avoid unnecessary dependencies.

## Business Rules

- Guests do not need accounts.
- Only admins can create events.
- Reservations start as pending.
- Payments are manually verified.
- Never automatically confirm a payment.
- Never allow overbooking.
- Store monetary amounts as integer cents.
- Protect participant personal information.

## Cost Constraints

- Target zero monthly infrastructure costs.
- Stay within Cloudflare free-tier limits.
- Never enable paid services automatically.
- No mandatory custom domain.

## Quality

- Run typecheck, lint and tests after changes.
- Fix failures before marking work complete.
- Write tests for critical reservation logic.
- Never commit credentials or secrets.
- Never deploy production without approval.

## Documentation

- Keep README.md updated.
- Document environment variables.
- Document migrations and deployment.
