export const BUSINESS_TYPES=[
  'Retail / E-commerce',
  'Restaurant / Cafe',
  'Real Estate',
  'Education / Coaching',
  'Healthcare / Clinic',
  'Hotel / Travel',
  'Beauty / Salon / Spa',
  'Automobile',
  'Banking / Finance / Insurance',
  'IT / SaaS',
  'Professional Services',
  'Construction',
  'Fitness / Gym',
  'Events / Wedding',
  'NGO / Nonprofit',
  'Manufacturing',
  'Logistics',
  'Agriculture',
  'Other'
];

export const BUSINESS_GOALS=[
  'Generate leads',
  'Increase sales',
  'Increase repeat customers',
  'Promote offers',
  'Improve customer support',
  'Appointments / bookings',
  'Payment / fee reminders',
  'Customer retention',
  'Re-engage inactive customers',
  'Announcements / updates',
  'Other'
];

const trim=(v,n=120)=>String(v||'').trim().slice(0,n);

export function cleanBusinessProfile(body={}){
  const businessType=trim(body.businessType,80);
  const primaryGoal=trim(body.primaryGoal,100);
  if(!BUSINESS_TYPES.includes(businessType))throw new Error('Choose a valid business type');
  if(!BUSINESS_GOALS.includes(primaryGoal))throw new Error('Choose a valid primary business goal');
  return {
    businessType,
    businessSubtype:trim(body.businessSubtype,100),
    primaryGoal,
    productsServices:trim(body.productsServices,500),
    targetCustomers:trim(body.targetCustomers,300),
    country:trim(body.country||'India',80),
    preferredLanguage:trim(body.preferredLanguage||'English',80),
    brandTone:trim(body.brandTone||'Professional',80)
  };
}
