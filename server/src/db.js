export function mongoUri(){
  if(process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const host=process.env.MONGODB_HOST;
  const user=process.env.MONGODB_USER;
  const password=process.env.MONGODB_PASSWORD;
  if(!host||!user||!password) throw new Error('MongoDB connection variables are required');
  return 'mongodb+srv://'+encodeURIComponent(user)+':'+encodeURIComponent(password)+'@'+host+'/clever_connect?retryWrites=true&w=majority';
}
