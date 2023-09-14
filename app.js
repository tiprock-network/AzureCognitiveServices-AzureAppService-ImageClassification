//Required Node Modules
const express=require('express')
const util=require('util')
const fs=require('fs')
const multer=require('multer')
const trainAPI=require('@azure/cognitiveservices-customvision-training')
const predAPI=require('@azure/cognitiveservices-customvision-prediction')
const msREST=require('@azure/ms-rest-js')
const publishIterationName="classifyGrocery"
const setTimeOutPromise=util.promisify(setTimeout)
const body_parser=require('body-parser')
//const fileUpload=require('express-fileupload')
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
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/'); // Set the directory where uploaded files will be stored
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + '.' + file.originalname.split('.').pop());
    },
});

//handles file uploads from the form
const upload=multer({dest:'uploads/',storage:storage})
let projectID=''

//create express app
const app=express()

//middleware
//set the view engine
app.set('view engine','ejs')
app.use(body_parser.urlencoded({extended:true}))
//app.use(fileUpload({useTempFiles: true,}))
app.use(express.static('public'))


//index page
app.get('/',(req,res)=>{
    res.render('index')
})


//create new project
app.get('/create-train-project', (req,res)=>{
    res.render('create')
})

app.post('/create-train-project',  upload.array('image', 10), async (req, res) => {
    try {
      const myNewProjectName = req.body.projName;
      const tag = req.body.projTag;
      const imageFiles = req.files;
  
      // Import id json
      const id_data = fs.readFileSync('id.json');
      console.log(`Name: ${myNewProjectName}\nTag: ${tag}`);
  
      // Ensure that project name, tag, and images are provided
      if (!myNewProjectName || !tag || !imageFiles) {
        return res.status(400).send('Project name, tag, and images are required.');
      }
  
      console.log(`Creating project...`);
      const project = await trainer.createProject(myNewProjectName);
      projectID = project.id;
  
      // after creating the project, save the ID to id.json
      const idsJSON = JSON.parse(id_data);
      idsJSON.projects.push({
        projId: projectID,
        projName: project.name,
      });
      fs.writeFileSync('id.json', JSON.stringify(idsJSON));
  
      // add tags for the pictures in the newly created project
      const tagObj = await trainer.createTag(projectID, tag);
  
      // upload data images
      console.log('Adding images...');
  
      // Process each uploaded image
      for (const imageFile of imageFiles) {
        const imageData = fs.readFileSync(imageFile.path);
  
        // Upload the image to the project with the specified tag
        await trainer.createImagesFromData(projectID, imageData, { tagIds: [tagObj.id] });
      }
  
      // train the model
      console.log('Training initialized...');
      var trainingIteration = await trainer.trainProject(project.id);
      console.log('Training in progress...');
  
      // train to completion
      while (trainingIteration.status === 'Training') {
        console.log(`Training status: ${trainingIteration.status}`);
        await setTimeOutPromise(1000);
        const updatedIteration = await trainer.getIteration(projectID, trainingIteration.id);
        if (updatedIteration.status !== 'Training') {
          console.log(`Training status: ${updatedIteration.status}`);
          break;
        }
      }
  
      // publish current iteration
      // Publish the iteration to the endpoint
      await trainer.publishIteration(project.id, trainingIteration.id, publishIterationName, process.env.resourcePredictionID);
  
      res.status(200).redirect('/classify-image');
    } catch (e) {
      console.log('This error occurred: ', e); // remember to change this to default behavior and not throw actual error
      res.status(500).send('An error occurred during project creation and training.');
    }
  });
  

//classify image
app.get('/classify-image', (req,res)=>{
    // Read the JSON file
    fs.readFile('id.json', 'utf8', (err, data) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error reading JSON file');
        }
        
        const projectsData = JSON.parse(data);
        let pred_results=[]
        // Pass the projectsData to the EJS template
        res.render('classify', { projects: projectsData.projects,pred_results:pred_results });
    });
    
})
app.post('/classify-image',  upload.single('image'),async (req,res)=>{
    try {
        
        // Check if a file was uploaded
        if (!req.file) {
            res.send('<p>Files Missing</p>');
            return;
        }
        if(!req.body.projId){
            res.send('<p>Project Id Missing</p>');
            return;
        }
       // Read the uploaded image file
        const fileimageBuffer = fs.readFileSync(req.file.path);

        const results = await pred.classifyImage(req.body.projId, publishIterationName, fileimageBuffer);
        let pred_results=[]
        let pred_val=0
        // Show results
        console.log("Results:");
        results.predictions.forEach(predictedResult => {
            console.log(`\t ${predictedResult.tagName}: ${(predictedResult.probability * 100.0).toFixed(2)}%`);
            pred_results.push(`${predictedResult.tagName}: ${(predictedResult.probability * 100.0).toFixed(2)}%`)
            pred_val=(predictedResult.probability * 100.0).toFixed(2)
        });
        fs.readFile('id.json', 'utf8', (err, data) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Error reading JSON file');
            }
  
            const projectsData = JSON.parse(data);
            if (pred_val>=50){
                pred_val='Passed'
            }
            
            // Pass the projectsData to the EJS template
            res.render('classify', { projects: projectsData.projects,pred_results:pred_results,pred_val });
        });

        
    } catch (e) {
        console.error('Error:', e);
        res.status(500).send('Error processing the image.');
        
    }
})

const PORT=process.env.PORT || 5003

//listen for the PORT number
app.listen(PORT,()=>console.log(`App listening on PORT: ${PORT}...`))


