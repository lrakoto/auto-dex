'use strict';

const bcrypt = require('bcryptjs');
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class user extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      models.user.hasMany(models.favorite_car);
      models.user.hasMany(models.user_car, { foreignKey: 'userId' });
      models.user.hasMany(models.spotting, { foreignKey: 'userId' });
    }
  };
  user.init({
    name: {
      type: DataTypes.STRING,
      validate: {
       len: {
        args: [1,99],
        msg: 'Name must be between 1 and 99 characters'
       }
      }
    },
    email: {
      type: DataTypes.STRING,
      // Canonicalize on write so Foo@x.com and foo@x.com are one account.
      set(value) {
        this.setDataValue('email', typeof value === 'string' ? value.trim().toLowerCase() : value);
      },
      validate: {
        isEmail: {
          msg: 'Invalid email'
        }
      }
    },
    password: {
      type: DataTypes.STRING,
      validate: {
        len: {
          args: [8,99],
          msg: 'Password must be between 8 and 99 characters'
        }
      }
    },
    isAdmin: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    emailVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    verificationToken: {
      type: DataTypes.STRING,
      allowNull: true
    },
    verificationTokenExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    lastLoginAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    // Public garage handle (/u/:username). Stored lowercase; see lib/usernames.js
    username: {
      type: DataTypes.STRING(30),
      allowNull: true,
      set(value) {
        this.setDataValue('username', typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null);
      }
    },
    garagePublic: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    // Password reset (hashed token, 1h expiry) — see controllers/auth.js
    passwordResetToken: {
      type: DataTypes.STRING,
      allowNull: true
    },
    passwordResetExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    // Bumped when the password is reset; sessions carrying an older value are
    // signed out (middleware in server.js)
    sessionVersion: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    }
  }, {
    sequelize,
    modelName: 'user',
  });

  user.addHook('beforeCreate', (pendingUser) => { 
    let hash = bcrypt.hashSync(pendingUser.password, 12); 
    pendingUser.password = hash; 
  }); 

  // Password changes on existing users (reset) must be hashed too — the
  // create hook alone would store the new password in plaintext.
  user.addHook('beforeUpdate', (existingUser) => {
    if (existingUser.changed('password')) {
      existingUser.password = bcrypt.hashSync(existingUser.password, 12);
    }
  });

  user.prototype.validPassword = function(typedPassword) {
    let isCorrectPassword = bcrypt.compareSync(typedPassword, this.password);

    return isCorrectPassword;
  }

  user.prototype.toJSON = function() {
    let userData = this.get();
    delete userData.password;
    delete userData.passwordResetToken;

    return userData;
  }

  return user; // add functions above 
};