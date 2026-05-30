package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type CounterResponse struct {
	TotalVisitors int    `json:"total_visitors"`
	Message       string `json:"message"`
}

type CounterItem struct {
	ID    string `dynamodbav:"id"`
	Count int    `dynamodbav:"count"`
}

var (
	dynamodbClient *dynamodb.Client
	tableName      string
)

func init() {
	// Initialize DynamoDB client
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("unable to load SDK config, %v", err)
	}

	dynamodbClient = dynamodb.NewFromConfig(cfg)
	tableName = os.Getenv("TABLE_NAME")
	if tableName == "" {
		tableName = "ResumeVisitorCounter"
	}
}

// Handler processes the API Gateway event and increments the visitor counter
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	log.Printf("Request: %s %s", request.HTTPMethod, request.Path)

	// CORS headers to allow resume.nine3one2.com
	corsHeaders := map[string]string{
		"Access-Control-Allow-Origin":      "https://resume.nine3one2.com",
		"Access-Control-Allow-Methods":     "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers":     "Content-Type",
		"Access-Control-Max-Age":           "86400",
		"Content-Type":                     "application/json",
	}

	// Handle CORS preflight
	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{
			StatusCode: 200,
			Headers:    corsHeaders,
			Body:       "",
		}, nil
	}

	// Only allow GET requests to increment counter
	if request.HTTPMethod != "GET" {
		return events.APIGatewayProxyResponse{
			StatusCode: 405,
			Headers:    corsHeaders,
			Body:       `{"error": "Method not allowed"}`,
		}, nil
	}

	// Increment the visitor counter
	response, err := incrementCounter(ctx)
	if err != nil {
		log.Printf("Error incrementing counter: %v", err)
		return events.APIGatewayProxyResponse{
			StatusCode: 500,
			Headers:    corsHeaders,
			Body:       fmt.Sprintf(`{"error": "%s"}`, err.Error()),
		}, nil
	}

	// Marshal response
	responseBody, err := json.Marshal(response)
	if err != nil {
		return events.APIGatewayProxyResponse{
			StatusCode: 500,
			Headers:    corsHeaders,
			Body:       `{"error": "Failed to marshal response"}`,
		}, nil
	}

	return events.APIGatewayProxyResponse{
		StatusCode: 200,
		Headers:    corsHeaders,
		Body:       string(responseBody),
	}, nil
}

// incrementCounter atomically increments the visitor counter using DynamoDB UpdateItem
func incrementCounter(ctx context.Context) (*CounterResponse, error) {
	// Use UpdateItem with atomic increment
	updateOutput, err := dynamodbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &tableName,
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: "total_visitors"},
		},
		UpdateExpression:       "ADD #count :inc",
		ExpressionAttributeNames: map[string]string{
			"#count": "count",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":inc": &types.AttributeValueMemberN{Value: "1"},
		},
		ReturnValues: types.ReturnValueAllNew,
	})

	if err != nil {
		return nil, fmt.Errorf("failed to update counter: %w", err)
	}

	// Parse the updated item
	var item CounterItem
	err = attributevalue.UnmarshalMap(updateOutput.Attributes, &item)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal item: %w", err)
	}

	return &CounterResponse{
		TotalVisitors: item.Count,
		Message:       "Visitor counter incremented",
	}, nil
}

func main() {
	lambda.Start(Handler)
}
