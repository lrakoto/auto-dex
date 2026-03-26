function isAdmin(req, res, next) {
  if (!req.user) {
    req.flash('error', 'You must be signed in to access that page');
    return res.redirect('/auth/login');
  }
  if (!req.user.isAdmin) {
    req.flash('error', 'You do not have permission to access that page');
    return res.redirect('/');
  }
  next();
}

module.exports = isAdmin;
