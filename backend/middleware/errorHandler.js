import { supabaseAdmin } from '../config/supabase.js';

export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message, errors = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.errors = errors;
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT');
  }
}

const handleSupabaseError = (error) => {
  // Handle Supabase/PostgreSQL specific errors
  if (error.code === '23505') { // Unique violation
    const constraint = error.constraint;
    let message = 'Duplicate entry';
    
    if (constraint?.includes('email')) message = 'Email already exists';
    else if (constraint?.includes('phone')) message = 'Phone number already exists';
    else if (constraint?.includes('slug')) message = 'Slug already exists';
    else if (constraint?.includes('order_number')) message = 'Order number already exists';
    
    return new AppError(message, 409, 'DUPLICATE_ENTRY');
  }
  
  if (error.code === '23503') { // Foreign key violation
    return new AppError('Referenced resource not found', 400, 'INVALID_REFERENCE');
  }
  
  if (error.code === '23514') { // Check constraint violation
    return new AppError('Invalid data provided', 400, 'CONSTRAINT_VIOLATION');
  }
  
  if (error.code === '42P01') { // Undefined table
    return new AppError('Database table not found', 500, 'TABLE_MISSING');
  }
  
  if (error.code === '42703') { // Undefined column
    return new AppError('Invalid database column', 500, 'COLUMN_MISSING');
  }
  
  return new AppError(error.message || 'Database error', 500, 'DATABASE_ERROR');
};

const handleJWTError = (error) => {
  if (error.name === 'JsonWebTokenError') {
    return new AppError('Invalid token', 401, 'INVALID_TOKEN');
  }
  if (error.name === 'TokenExpiredError') {
    return new AppError('Token expired', 401, 'TOKEN_EXPIRED');
  }
  return new AppError('Authentication error', 401, 'AUTH_ERROR');
};

const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
    success: false,
    error: err,
    message: err.message,
    code: err.code,
    stack: err.stack,
    errors: err.errors
  });
};

const sendErrorProd = (err, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
      errors: err.errors
    });
  } else {
    // Programming or other unknown error: don't leak details
    console.error('ERROR 💥', err);
    
    res.status(500).json({
      success: false,
      message: 'Something went wrong',
      code: 'INTERNAL_ERROR'
    });
  }
};

export const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.code = err.code || 'INTERNAL_ERROR';
  
  // Handle specific error types
  let error = err;
  
  if (err.code && err.code.startsWith('23')) {
    error = handleSupabaseError(err);
  } else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    error = handleJWTError(err);
  } else if (err.name === 'ValidationError') {
    error = new ValidationError('Validation failed', err.errors);
  }
  
  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(error, res);
  } else {
    sendErrorProd(error, res);
  }
};

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export const notFound = (req, res, next) => {
  const error = new NotFoundError(`Route ${req.originalUrl}`);
  next(error);
};