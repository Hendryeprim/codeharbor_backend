import slugify from 'slugify';

export const createSlug = (text) => {
  return slugify(text, {
    lower: true,
    strict: true,
    trim: true,
  });
};

