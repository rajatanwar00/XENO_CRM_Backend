require('dotenv').config();
const express=require('express')
const app=express()

const cors=require('cors')
app.use(cors({
    origin: '*', 
    methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'], 
    allowedHeaders: ['Content-Type', 'Authorization'], 
    credentials: true,
}));

const bodyParser=require('body-parser')
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({extended:true}));

const { OAuth2Client } = require('google-auth-library');
const clientID=process.env.CLIENT_ID;
const client = new OAuth2Client(clientID);

const db=require('./db')
const jwt=require('jsonwebtoken')
const SECRET_KEY = process.env.SECRET_KEY;








app.post('/login',async (req,res)=>{
    const authToken=req.body.authToken;

    try{

        // const ticket=await googleVerify(authToken,clientID);

        const ticket=await client.verifyIdToken({
            idToken:authToken,
            audience:clientID
        });

        //console.log("heree",ticket);

        const payload = await ticket.getPayload();
        const {sub,email,name,picture} = payload;

        let sqlquery='select * from users where email=?';
        let rows = await new Promise((resolve,reject)=>{
            db.execute(sqlquery,[email],(err,result)=>{
                if(err){
                    reject(err);
                }
                else{
                    resolve(result);
                }
            });
        })
            
        //db.execute(sqlquery,[email]);
        //console.log("rows",rows)
        let user=rows[0];
        //console.log("between",user);

        if(!user){
            sqlquery='insert into users (google_sub,email,name,picture) values (?,?,?,?)';
            await new Promise((resolve,reject)=>{
                db.execute(sqlquery,[sub,email,name,picture],(err,result)=>{
                    if(err){
                        reject(err);
                    }
                    else{
                        resolve(result);
                    }
                })
            })
            //await db.execute(sqlquery,[sub,email,name,picture])

            sqlquery='select * from users where email=?';
            rows = await new Promise((resolve,reject)=>{
                db.execute(sqlquery,[email],(err,result)=>{
                    if(err){
                        reject(err);
                    }
                    else{
                        resolve(result);
                    }
                });
            })
            user=rows[0];
            //console.log("temp here",user);
        }

        const token=jwt.sign({id:user.user_id,email},SECRET_KEY,{expiresIn:'1d'})

        res.status(200).json({token,message:"Authentication Successful"});
    }
    catch(err){
        console.error('Token verification error:', err);
        res.status(401).json({ error: 'Invalid ID token' });
    }
    
})

app.get('/users',async (req,res)=>{

    //console.log(req.body,req.headers)

    const token = req.headers['authorization'] && req.headers['authorization'].split(' ')[1];

    if (!token) {
        return res.status(403).json({ message: 'No token provided' });
    }

    jwt.verify(token,SECRET_KEY,async (err,decoded)=>{
        if (err) {
            return res.status(401).json({ message: 'Unauthorized', error: err.message });
        }
        else{
            //console.log("decoded",decoded)
            let user=decoded;
            let data;

            try{
                data=await new Promise((resolve,reject)=>{
                    let sqlquery='select * from users where user_id = ?'
                    db.execute(sqlquery,[user.id],(err,result)=>{
                        if(err){
                            reject(err)
                        }
                        else{
                            resolve(result)
                        }
                    })
                })
                //console.log("data", data)
            }
            catch(err){
                console.log(err);
            }          

            return res.status(200).json({message:"User Data",data:data})
        }
    })

})

app.post('/customers/filter',async (req,res)=>{
    //console.log("in")
    const token = req.headers['authorization'] && req.headers['authorization'].split(' ')[1];

    if (!token) {
        return res.status(403).json({ message: 'No token provided' });
    }

    try{
        const decoded = jwt.verify(token,SECRET_KEY); 
        const {
            spendingCondition,
            spending,
            visitsCondition,
            visits,
            lastvisitCondition,
            lastvisit,
          } = req.body;

          let values=[spending,visits,lastvisit]
          let sqlquery=`select count(*) from customers where total_spending ${spendingCondition=='greater' ? '>':'<'} ? and no_visits ${visitsCondition=='greater'?'>':'<'} ? and last_visit ${lastvisitCondition=='before'?'<':'>'} ?`;

          console.log("before query ", decoded)
          db.execute(sqlquery,values,(err,result)=>{
            if(err){
                console.log(err)
            }
            else{
                console.log(result);
                return res.status(200).json(result);
            }
          })
    }
    catch(err){
        console.log(err)
        return res.status(501);
    }
})

app.post('/campaign',async (req,res)=>{
    const token = req.headers['authorization'] && req.headers['authorization'].split(' ')[1];

    if (!token) {
        return res.status(403).json({ message: 'No token provided' });
    }

    try{
        const decoded = jwt.verify(token,SECRET_KEY); 
        const {
            campaignName,
            campaignDesc,
            criteria
        } = req.body;

        console.log(campaignName,campaignDesc)

        let values=[campaignName,campaignDesc]
        let sqlquery='insert into campaign (name,description) values (?,?)';
        let campaignID;
        const q=await new Promise((resolve,reject)=>{
            db.execute(sqlquery,values,(err,result)=>{
                if(err){
                    console.log(err)
                    return reject(err)
                }
                else{
                    console.log(result);
                    campaignID=result.insertId;
                    return resolve(result)
                }
              })
        }) 

        values=[criteria.spending,criteria.visits,criteria.lastvisit]
        sqlquery=`select customer_id from customers where total_spending ${criteria.spendingCondition=='greater' ? '>':'<'} ? and no_visits ${criteria.visitsCondition=='greater'?'>':'<'} ? and last_visit ${criteria.lastvisitCondition=='before'?'<':'>'} ?`;

          
        const filteredCustomers=await new Promise((resolve,reject)=>{
            db.execute(sqlquery,values,(err,result)=>{
                if(err){
                    console.log(err)
                    reject(err)
                }
                else{
                    //console.log(result);
                    resolve(result);
                }
              })
        })  

        const customers = filteredCustomers.map(row => row.customer_id);

        console.log("customers",customers[0],customers[1])

        if (customers.length > 0) {
            const insertCampaignCustomersQuery = `
                INSERT INTO Campaign_Cutomers (campaign_id, customer_id, added_at)
                VALUES ?
            `;
        
            const today = new Date(); 
            const formattedDate = today.toISOString().split('T')[0];
            const values = customers.map(customer_id => [campaignID, customer_id,formattedDate]);
        
            db.query(insertCampaignCustomersQuery, [values], (err, result) => {
                if (err) {
                    console.log("Error inserting into Campaign_Customers: ", err);
                    return;
                }
                console.log("Customers added to campaign successfully",result);
                return res.status(200).json(result);
            });
        }

        
    }
    catch(err){
        console.log(err)
        return res.status(501);
    }
})

app.post('/customers',(req,res)=>{
    //console.log(req.body);
    const {name,email,total_spending,no_visits,last_visit} = req.body;
    const query = 'INSERT INTO customers (name,email,total_spending,no_visits,last_visit) VALUES (?,?,?,?,?)';
    db.query(query,[name,email,total_spending,no_visits,last_visit],(err,result)=>{
        if(err){
            return res.sendStatus(500);
        }
        else{
            console.log(result);
            return res.status(201).json({message:'Customer added successfully', customerId:result.insertId});
        }
    })
})

app.post('/customers/:customerId/orders',(req,res)=>{
    const customerID=req.params.customerId;
    const {order_date,total_amount}=req.body;
    const sqlquery='INSERT INTO orders (customer_id,order_date,total_amount) VALUES (?,?,?)';

    db.query(sqlquery,[customerID,order_date,total_amount],(err,result)=>{
        if(err){
            return res.status(500);
        }
        else{
            console.log(result);
            return res.status(201).send(result);
        }
    })
})

app.listen(3000);