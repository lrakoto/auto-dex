const db = require('../models');

before(async function() {
  await db.sequelize.sync({ force: true });
  await db.user.create({
    email: 'known@example.com',
    name: 'Known User',
    password: '123123123'
  });
});

describe('Creating a User', function() {
  it('should create successfully', async function() {
    await db.user.create({
      email: 'test@test.co',
      name: 'Muttbuncher',
      password: 'password'
    });
  });

  it('should throw an error on invalid email addresses', async function() {
    try {
      await db.user.create({ email: 'test', name: 'Brian', password: 'password' });
      throw new Error('expected validation to fail');
    } catch (error) {
      if (error.message === 'expected validation to fail') throw error;
    }
  });

  it('should throw an error on invalid name', async function() {
    try {
      await db.user.create({ email: 'test2@test.co', name: '', password: 'password' });
      throw new Error('expected validation to fail');
    } catch (error) {
      if (error.message === 'expected validation to fail') throw error;
    }
  });

  it('should throw an error on invalid password', async function() {
    try {
      await db.user.create({ email: 'test3@test.co', name: 'Brian', password: 'short' });
      throw new Error('expected validation to fail');
    } catch (error) {
      if (error.message === 'expected validation to fail') throw error;
    }
  });

  it('should hash the password before save', async function() {
    const newUser = await db.user.create({
      email: 'hash@test.co',
      name: 'Muttbuncher',
      password: 'password'
    });
    if (newUser.password === 'password') throw new Error('password stored in plaintext');
  });
});

describe('User instance methods', function() {
  describe('validPassword', function() {
    it('should validate a correct password', async function() {
      const user = await db.user.findOne({ where: { email: 'known@example.com' } });
      if (!user.validPassword('123123123')) throw new Error('valid password rejected');
    });

    it('should invalidate an incorrect password', async function() {
      const user = await db.user.findOne({ where: { email: 'known@example.com' } });
      if (user.validPassword('nope')) throw new Error('invalid password accepted');
    });
  });

  describe('toJSON', function() {
    it('should return a user without a password field', async function() {
      const user = await db.user.findOne({ where: { email: 'known@example.com' } });
      if (user.toJSON().password !== undefined) throw new Error('password leaked into toJSON');
    });
  });
});
