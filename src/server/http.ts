import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodSchema } from "zod";

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export function notFound(message = "Not found"): HttpError {
  return new HttpError(404, message);
}

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: "Invalid request", details: result.error.flatten() });
      return;
    }
    req.body = result.data;
    next();
  };
}
