# STH Fresh Fruit - Render deployment

This package is arranged so Express serves the frontend from `public/`.

## Render
1. Create a new Web Service from this project/repository.
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Add environment variables: `JWT_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
5. Deploy. Render will provide an `onrender.com` HTTPS URL.

## Important
The current application stores data in SQLite (`sth_fresh_fruit.db`). A hosted service needs persistent storage/database planning before production use; otherwise database changes may not survive replacement/redeploy depending on the hosting setup.

Change the demo admin password before real use and configure Razorpay production credentials only after verifying payment/webhook handling.
