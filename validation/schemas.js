const Joi = require("joi");

const userSchemas = {
  register: Joi.object({
    name: Joi.string().required().min(2).max(50),
    email: Joi.string().required().email(),
    password: Joi.string().required().min(6),
    phone: Joi.string()
      .required()
      .pattern(/^[0-9]{10}$/),
    isAdmin: Joi.boolean().optional(),

    address: Joi.object({
      street: Joi.string(),
      city: Joi.string(),
      state: Joi.string(),
      zipCode: Joi.string(),
      country: Joi.string(),
    }),
  }),

  login: Joi.object({
    email: Joi.string().required().email(),
    password: Joi.string().required(),
  }),

  updateProfile: Joi.object({
    name: Joi.string().min(2).max(50),
    email: Joi.string().email(),
    phone: Joi.string(),
    gender: Joi.string().valid("Male", "Female"),
    dateOfBirth: Joi.date(),
    address: Joi.object({
      street: Joi.string().allow(""),
      city: Joi.string().allow(""),
      state: Joi.string().allow(""),
      zipCode: Joi.string().allow(""),
      country: Joi.string().allow(""),
    }).allow(null),
    preferences: Joi.object({
      newsletter: Joi.boolean(),
      orderUpdates: Joi.boolean(),
      marketing: Joi.boolean(),
      language: Joi.string(),
      currency: Joi.string(),
    }),
  }),
};

module.exports = {
  userSchemas,
};
