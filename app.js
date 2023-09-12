//Required Node Modules
const express=require('express')
const util=require('util')
const fs=require('fs')
const trainAPI=require('@azure/cognitiveservices-customvision-training')
const predAPI=require('@azure/cognitiveservices-customvision-prediction')
const msREST=require('@azure/ms-rest-js')
const publishIterationName="classifyGrocery"
const setTimeOutPromise=util.promisify(setTimeout)
const dotenv=require('dotenv')
//configure environment
dotenv.config()

//variables
const trainer_endpoint=process.env.resourceTrainingENDPOINT
const pred_endpoint=process.env.resourcePredictionENDPOINT
const creds=new msREST.ApiKeyCredentials({inHeader:{'Training-key':process.env.resourceTrainingKEY}})
const trainer=new trainAPI.TrainingAPIClient(creds,trainer_endpoint)
const pred_creds=new msREST.ApiKeyCredentials({inHeader:{'Prediction-key':process.env.resourcePredictionKEY}})
const pred=new predAPI.PredictionAPIClient(pred_creds,pred_endpoint)
const rootImgFolder='./public/images'
let projectID=''
//create express app
const app=express()
const userRoute=require('./routers/userRoute')


//middleware
app.set('view engine','ejs')

//user route
app.use('/account',userRoute)


//index page
app.get('/',(req,res)=>{
    res.render('index')
})

//create new project
app.get('/create-train-project', async (req,res)=>{
    try {
        console.log(`Creating project...`)
        const project=await trainer.createProject("groceryStore")
        projectID=project.id
        //add tags for the pictures in the newly created project
        const asparagusTag = await trainer.createTag(project.id, "asparagus");
        //const tomatoTag = await trainer.createTag(project.id, "tomato");
        const carrotTag= await trainer.createTag(project.id,"carrot")

        //upload data images
        console.log('Adding images...')

        let fileUploadPromises=[]
        
        //get the location of your files
        const asparagus_files=fs.readdirSync(`${rootImgFolder}/asparagus`)
        asparagus_files.forEach(file=>{
            fileUploadPromises.push(trainer.createImagesFromData(project.id,fs.readFileSync(`${rootImgFolder}/asparagus/${file}`),{tagIds:[asparagusTag.id]}))
        })

        const carrot_files=fs.readdirSync(`${rootImgFolder}/carrot`)
        carrot_files.forEach(file=>{
            fileUploadPromises.push(trainer.createImagesFromData(project.id,fs.readFileSync(`${rootImgFolder}/carrot/${file}`),{tagIds:[carrotTag.id]}))
        })

        /*const tomato_files=fs.readdirSync(`${rootImgFolder}/tomato`)
        tomato_files.forEach(file=>{
            fileUploadPromises.push(trainer.createImagesFromData(project.id,fs.readFileSync(`${rootImgFolder}/tomato/${file}`),{tagIds:[tomatoTag.id]}))
        })*/
        await Promise.all(fileUploadPromises)

        //train the model
        console.log('Training initialized...')
        var trainingIteration=await trainer.trainProject(project.id)
        console.log('Training in progress...')
        //train to completion
        while(trainingIteration.status==="Training"){
            console.log(`Training status: ${trainingIteration.status}`)
            await setTimeOutPromise(1000,null)
            trainingIteration=await trainer.getIteration(project.id,trainingIteration.id)
        }

        console.log(`Training status: ${trainingIteration.status}`)

        //publish current iteration
        // Publish the iteration to the end point
        await trainer.publishIteration(project.id, trainingIteration.id, publishIterationName, process.env.resourcePredictionID);

        res.status(200).send(`<h1>Project grocery items created and trained.</h1> <br><br> <a href="/classify-image">Test Images</a>`)
    } catch (e) {
        console.log('This error occurred: ',e)//remember to change this to default behaviour and not throw actual error
    }
})

app.get('/classify-image',async (req,res)=>{
    const testFile = fs.readFileSync(`${rootImgFolder}/test/1.jpg`);

    const results = await pred.classifyImage(projectID, publishIterationName, testFile);
    let pred_results=[]
    // Show results
    console.log("Results:");
    results.predictions.forEach(predictedResult => {
        console.log(`\t ${predictedResult.tagName}: ${(predictedResult.probability * 100.0).toFixed(2)}%`);
        pred_results.push(`${predictedResult.tagName}: ${(predictedResult.probability * 100.0).toFixed(2)}%`)
    });

    res.send(`<h1>Prediction Results:</h1><br><br>${pred_results}`)
})

const PORT=process.env.PORT || 5003

//listen for the PORT number
app.listen(PORT,()=>console.log(`App listening on PORT: ${PORT}...`))


