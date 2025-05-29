from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from datetime import datetime, timedelta
import json
import asyncio
import os
from typing import List, Dict
from database import get_production_units, get_production_data, get_db_connection, TIMEZONE, calculate_break_time
import pytz

# Define timezone constant for application (GMT+3)
TIMEZONE = pytz.timezone('Europe/Istanbul')  # Turkey is in GMT+3

app = FastAPI()

# Enable CORS
origins = [
    "http://localhost",
    "http://localhost:8000",
    "http://127.0.0.1",
    "http://127.0.0.1:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Get the absolute path to the frontend directory
FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
print(f"Frontend directory: {FRONTEND_DIR}")

# Mount static files for JS, CSS, etc. (not at root to avoid WebSocket conflicts)
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

# Main index route
@app.get("/")
async def read_root():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

# JS files routes
@app.get("/app.js")
async def get_app_js():
    return FileResponse(os.path.join(FRONTEND_DIR, "app.js"))

@app.get("/standart.js")
async def get_standart_js():
    return FileResponse(os.path.join(FRONTEND_DIR, "standart.js"))

@app.get("/hourly.js")
async def get_hourly_js():
    return FileResponse(os.path.join(FRONTEND_DIR, "hourly.js"))

# Standard view route
@app.get("/standart.html")
async def get_standart_html():
    file_path = os.path.join(FRONTEND_DIR, "standart.html")
    if os.path.exists(file_path):
        return FileResponse(file_path)
    else:
        raise HTTPException(status_code=404, detail=f"File not found at {file_path}")

# Hourly view route (original, keep for backwards compatibility)
@app.get("/hourly")
async def read_hourly():
    return FileResponse(os.path.join(FRONTEND_DIR, "hourly.html"))

# Hourly view route with .html extension
@app.get("/hourly.html")
async def get_hourly_html():
    file_path = os.path.join(FRONTEND_DIR, "hourly.html")
    if os.path.exists(file_path):
        return FileResponse(file_path)
    else:
        raise HTTPException(status_code=404, detail=f"File not found at {file_path}")

# Test automation route
@app.get("/test")
async def get_test():
    test_file_path = os.path.join(FRONTEND_DIR, "test_automation.html")
    if os.path.exists(test_file_path):
        return FileResponse(test_file_path)
    else:
        raise HTTPException(status_code=404, detail=f"Test file not found at {test_file_path}")

# Debug automation route
@app.get("/debug")
async def get_debug():
    debug_file_path = os.path.join(FRONTEND_DIR, "debug_automation.html")
    if os.path.exists(debug_file_path):
        return FileResponse(debug_file_path)
    else:
        raise HTTPException(status_code=404, detail=f"Debug file not found at {debug_file_path}")

# Shift change test route
@app.get("/test-shifts")
async def get_test_shifts():
    test_file_path = os.path.join(FRONTEND_DIR, "test_shift_change.html")
    if os.path.exists(test_file_path):
        return FileResponse(test_file_path)
    else:
        raise HTTPException(status_code=404, detail=f"Test shifts file not found at {test_file_path}")

# OEE comparison debug tool route
@app.get("/debug-oee")
async def get_debug_oee():
    debug_file_path = os.path.join(os.path.dirname(__file__), "debug_oee_comparison.html")
    if os.path.exists(debug_file_path):
        return FileResponse(debug_file_path)
    else:
        raise HTTPException(status_code=404, detail=f"Debug OEE file not found at {debug_file_path}")

# Report route
@app.get("/report")
async def get_report():
    report_file_path = os.path.join(FRONTEND_DIR, "report.html")
    if os.path.exists(report_file_path):
        return FileResponse(report_file_path)
    else:
        raise HTTPException(status_code=404, detail="Report page not found")

@app.get("/report.js")
async def get_report_js():
    report_js_path = os.path.join(FRONTEND_DIR, "report.js")
    if os.path.exists(report_js_path):
        return FileResponse(report_js_path, media_type="application/javascript")
    else:
        raise HTTPException(status_code=404, detail="Report JavaScript not found")

# Class to manage WebSocket connections
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {
            'standard': [],
            'hourly': []
        }

    async def connect(self, websocket: WebSocket, connection_type: str = 'standard'):
        await websocket.accept()
        if connection_type not in self.active_connections:
            self.active_connections[connection_type] = []
        self.active_connections[connection_type].append(websocket)

    def disconnect(self, websocket: WebSocket, connection_type: str = 'standard'):
        if connection_type in self.active_connections:
            if websocket in self.active_connections[connection_type]:
                self.active_connections[connection_type].remove(websocket)

    async def broadcast(self, message: str, connection_type: str = 'standard'):
        if connection_type in self.active_connections:
            for connection in self.active_connections[connection_type]:
                await connection.send_text(message)

manager = ConnectionManager()

# API endpoint to get available production units
@app.get("/units")
async def get_units():
    return get_production_units()

# WebSocket endpoint for standard dashboard
@app.websocket("/ws/{unit_name}")
async def websocket_endpoint(websocket: WebSocket, unit_name: str):
    await manager.connect(websocket, 'standard')
    try:
        while True:
            try:
                data = await websocket.receive_text()
                params = json.loads(data)
                
                # Fix ISO format strings with 'Z' timezone
                start_time_str = params['start_time'].replace('Z', '+00:00')
                end_time_str = params['end_time'].replace('Z', '+00:00')
                
                # Extract working mode (default to mode1 if not provided)
                working_mode = params.get('working_mode', 'mode1')
                
                # Parse as UTC first
                start_time = datetime.fromisoformat(start_time_str)
                end_time = datetime.fromisoformat(end_time_str)
                
                # Convert to application timezone (GMT+3)
                if start_time.tzinfo is not None:
                    start_time = start_time.astimezone(TIMEZONE)
                    end_time = end_time.astimezone(TIMEZONE)
                
                # Get current time in GMT+3
                current_time = datetime.now(TIMEZONE)
                
                # Get production data and filter models with target
                production_data = get_production_data(unit_name, start_time, end_time, current_time, working_mode)
                
                # For each model, if it has no target, set performance and OEE to None
                for model in production_data:
                    if not model['target']:
                        model['performance'] = None
                        model['oee'] = None
                
                                # Check if connection is still open before sending
                if websocket.client_state.name == 'CONNECTED':
                    await websocket.send_json(production_data)
                    # print(f"=== Sent updated standard data to client for {unit_name} at {datetime.now(TIMEZONE)} ===")
                else:
                    # print("WebSocket connection closed, cannot send response")
                    break
                    
                await asyncio.sleep(30)
            except WebSocketDisconnect:
                # If websocket is disconnected during processing, break the loop
                # print(f"WebSocket disconnected during processing for {unit_name}")
                break
            except ValueError as e:
                print(f"Error processing WebSocket data: {e}")
                try:
                    error_response = {"error": str(e)}
                    await websocket.send_json(error_response)
                except Exception as e:
                    # Handle any exception during error response sending
                    print(f"Could not send error response: {str(e)}")
                    break
            except Exception as e:
                print(f"Unexpected error in WebSocket connection: {e}")
                try:
                    error_response = {"error": "An unexpected error occurred"}
                    await websocket.send_json(error_response)
                except Exception as send_err:
                    # Handle any exception during error response sending
                    print(f"Could not send error response: {str(send_err)}")
                    break
    except Exception as e:
        print(f"Outer exception in standard WebSocket handler: {e}")
    finally:
        manager.disconnect(websocket, 'standard')
        # print(f"WebSocket connection cleaned up for {unit_name}")

# WebSocket endpoint for hourly data
@app.websocket("/ws/hourly/{unit_name}")
async def hourly_websocket_endpoint(websocket: WebSocket, unit_name: str):
    await manager.connect(websocket, 'hourly')
    try:
        while True:
            try:
                data = await websocket.receive_text()
                params = json.loads(data)
                
                # Fix ISO format strings with 'Z' timezone
                start_time_str = params['start_time'].replace('Z', '+00:00')
                end_time_str = params['end_time'].replace('Z', '+00:00')
                
                # Extract working mode (default to mode1 if not provided)
                working_mode = params.get('working_mode', 'mode1')
                
                # Parse timestamps as UTC first
                start_time = datetime.fromisoformat(start_time_str)
                end_time = datetime.fromisoformat(end_time_str)
                
                # Convert to application timezone (GMT+3)
                if start_time.tzinfo is not None:
                    start_time = start_time.astimezone(TIMEZONE)
                    end_time = end_time.astimezone(TIMEZONE)
                
                # Get current time in GMT+3
                current_time = datetime.now(TIMEZONE)
                
                # print(f"\n===== HOURLY UPDATE REQUEST: {current_time} =====")
                # print(f"Processing hourly data for {unit_name}")
                # print(f"Time range (GMT+3): {start_time} to {end_time}")
                # print(f"Current time (GMT+3): {current_time}")
                
                # Get all raw data in one query for the entire time range
                raw_data = get_production_data(unit_name, start_time, end_time, current_time, working_mode)
                # print(f"Retrieved {len(raw_data)} raw data records for the entire period")
                
                # Calculate totals from raw data first
                total_success = sum(model['success_qty'] for model in raw_data)
                total_fail = sum(model['fail_qty'] for model in raw_data)
                total_qty = sum(model['total_qty'] for model in raw_data)
                
                # Direct calculation of quality as success/total
                total_quality = total_success / total_qty if total_qty > 0 else 0
                
                # print(f"\n=== Final totals for {unit_name} from raw data ===")
                # print(f"Total success: {total_success}")
                # print(f"Total fail: {total_fail}")
                # print(f"Total quantity: {total_qty}")
                # print(f"Total quality: {total_quality:.4f}" if total_quality is not None else "Total quality: None")
                
                # Calculate total performance and OEE using the raw model data
                models_with_target = [model for model in raw_data if model['target'] is not None]
                total_performance = None
                total_oee = None
                
                if models_with_target:
                    operation_time_total = (current_time - start_time).total_seconds() if current_time > start_time else 0
                    
                    # Calculate and subtract break time
                    break_time = calculate_break_time(start_time, current_time, working_mode)
                    operation_time = operation_time_total - break_time
                    
                    # Ensure operation time is not negative
                    operation_time = max(operation_time, 0)
                    
                    total_theoretical_time = 0
                    
                    # Calculate theoretical time for each model
                    for model in models_with_target:
                        model_theoretical_time = model['total_qty'] * (3600 / model['target'])
                        total_theoretical_time += model_theoretical_time
                    
                    # Calculate overall performance 
                    total_performance = total_theoretical_time / operation_time if operation_time > 0 else 0
                    
                    # Calculate overall OEE (set to None as per requirement #3)
                    total_oee = None
                    
                    # print(f"Total theoretical time: {total_theoretical_time:.2f} seconds")
                    # print(f"Total operation time: {operation_time_total:.2f} seconds")
                    # print(f"Break time: {break_time:.2f} seconds")
                    # print(f"Net operation time: {operation_time:.2f} seconds")
                    # print(f"Total performance: {total_performance:.4f}" if total_performance is not None else "Total performance: None")
                else:
                    print("No models with target found")
                
                # Now process hourly data using the raw data
                hourly_data = []
                
                # Initialize hourly containers for the entire time range
                current_hour = start_time.replace(minute=0, second=0, microsecond=0)
                hour_containers = {}
                
                while current_hour < end_time:
                    hour_end = min(current_hour + timedelta(hours=1), end_time)
                    
                    # Store both the full ISO format and the naive format for easier matching
                    hour_key = current_hour.isoformat()
                    
                    # Initialize hour container
                    hour_containers[hour_key] = {
                        'hour_start': current_hour,
                        'hour_end': hour_end,
                        'success_qty': 0,
                        'fail_qty': 0,
                        'total_qty': 0,
                        'is_current': current_hour <= current_time < hour_end
                    }
                    
                    # Move to next hour
                    current_hour += timedelta(hours=1)
                
                # Get detailed data directly using one query
                conn = get_db_connection()
                cursor = conn.cursor()
                
                # Query all individual records for detailed time-based grouping
                detail_query = """
                SELECT 
                    Model,
                    KayitTarihi,
                    TestSonucu,
                    ModelSuresiSN as Target
                FROM 
                    ProductRecordLogView
                WHERE 
                    UnitName = ? 
                    AND KayitTarihi BETWEEN ? AND ?
                ORDER BY
                    KayitTarihi
                """
                
                cursor.execute(detail_query, (unit_name, start_time, current_time))
                all_records = cursor.fetchall()
                # print(f"Retrieved {len(all_records)} individual records for hourly processing")
                
                # Group models by hour based on timestamp
                hourly_models = {}
                
                for row in all_records:
                    model_name = row[0]
                    timestamp = row[1]
                    success = row[2]
                    target = row[3]
                    
                    # Ensure target is valid (not None and greater than 0)
                    if target is not None and target <= 0:
                        target = None
                    
                    # Determine hour this record belongs to
                    record_hour = timestamp.replace(minute=0, second=0, microsecond=0)
                    
                    # Ensure record_hour has same timezone as the containers
                    if record_hour.tzinfo is None and start_time.tzinfo is not None:
                        record_hour = TIMEZONE.localize(record_hour)
                    elif record_hour.tzinfo is not None and record_hour.tzinfo != start_time.tzinfo:
                        record_hour = record_hour.astimezone(start_time.tzinfo)
                    
                    hour_key = record_hour.isoformat()
                    
                    # Skip if hour is outside our range
                    if hour_key not in hour_containers:
                        continue
                    
                    # Initialize hour's models dictionary if needed
                    if hour_key not in hourly_models:
                        hourly_models[hour_key] = {}
                    
                    # Initialize model in this hour if needed
                    if model_name not in hourly_models[hour_key]:
                        hourly_models[hour_key][model_name] = {
                            'model': model_name,
                            'success_qty': 0,
                            'fail_qty': 0,
                            'total_qty': 0,
                            'target': target
                        }
                    
                    # Update model counters for this hour
                    if success == 1:
                        hourly_models[hour_key][model_name]['success_qty'] += 1
                        hourly_models[hour_key][model_name]['total_qty'] += 1  # Only count successes for total_qty
                    else:
                        hourly_models[hour_key][model_name]['fail_qty'] += 1
                    
                    # Update hour container totals
                    if success == 1:
                        hour_containers[hour_key]['success_qty'] += 1
                        hour_containers[hour_key]['total_qty'] += 1  # Only count successes for total_qty
                    else:
                        hour_containers[hour_key]['fail_qty'] += 1
                
                cursor.close()
                conn.close()
                
                # print("\nHourly data summary:")
                # Calculate metrics for each hour
                for hour_key, container in hour_containers.items():
                    hour_start = container['hour_start']
                    hour_end = container['hour_end']
                    is_current = container['is_current']
                    
                    # Get models for this hour
                    hour_model_list = []
                    if hour_key in hourly_models:
                        hour_model_list = list(hourly_models[hour_key].values())
                    
                    # Create hour summary structure
                    hour_summary = {
                        'hour_start': hour_start.isoformat(),
                        'hour_end': hour_end.isoformat(),
                        'success_qty': container['success_qty'],
                        'fail_qty': container['fail_qty'],
                        'total_qty': container['total_qty'],
                        'quality': 0,
                        'performance': None,
                        'oee': None
                    }
                    
                    # Calculate quality
                    if hour_summary['total_qty'] > 0:
                        hour_summary['quality'] = hour_summary['success_qty'] / hour_summary['total_qty']
                    else:
                        hour_summary['quality'] = 0
                    
                    # Calculate performance and OEE for this hour
                    if hour_model_list:
                        models_with_target = [model for model in hour_model_list if model['target'] is not None]
                        
                        if models_with_target:
                            # Set operation time based on whether this is the current hour
                            if is_current:
                                operation_time_total = (current_time - hour_start).total_seconds()
                            else:
                                operation_time_total = (hour_end - hour_start).total_seconds()
                            
                            # Calculate and subtract break time for this hour
                            hour_end_time = current_time if is_current else hour_end
                            break_time = calculate_break_time(hour_start, hour_end_time, working_mode)
                            operation_time = operation_time_total - break_time
                            
                            # Ensure operation time is not negative
                            operation_time = max(operation_time, 0)
                            
                            # Calculate theoretical time
                            hour_theoretical_time = 0
                            for model in models_with_target:
                                if model['target'] is not None and model['target'] > 0:
                                    model_theoretical_time = model['total_qty'] * (3600 / model['target'])
                                    hour_theoretical_time += model_theoretical_time
                            
                            # Calculate performance (remove OEE calculation as per requirement #3)
                            if operation_time > 0 and hour_theoretical_time > 0:
                                hour_summary['performance'] = hour_theoretical_time / operation_time
                                hour_summary['oee'] = None  # Remove OEE calculation as per requirement #3
                    
                    # Add hour to final data
                    hourly_data.append(hour_summary)
                    
                    # # Log hour summary
                    # quality_str = f"{hour_summary['quality']*100:.4f}%" if hour_summary['quality'] is not None else "None"
                    # performance_str = f"{hour_summary['performance']*100:.4f}%" if hour_summary['performance'] is not None else "None"
                    # oee_str = f"{hour_summary['oee']*100:.4f}%" if hour_summary['oee'] is not None else "None"
                    
                    # print(f"Hour {hour_start.hour}:00-{hour_end.hour}:00: " + 
                    #       f"success={hour_summary['success_qty']}, " +
                    #       f"fail={hour_summary['fail_qty']}, " +
                    #       f"total={hour_summary['total_qty']}, " +
                    #       f"quality={quality_str}, " +
                    #       f"performance={performance_str}, " +
                    #       f"oee={oee_str}")
                
                # Verify total counts from hourly data match raw data totals
                hourly_success = sum(hour['success_qty'] for hour in hourly_data)
                hourly_fail = sum(hour['fail_qty'] for hour in hourly_data)
                hourly_total = sum(hour['total_qty'] for hour in hourly_data)
                
                # print(f"\n=== Verification of hourly totals ===")
                # print(f"Raw data totals: success={total_success}, fail={total_fail}, total={total_qty}")
                # print(f"Hourly data totals: success={hourly_success}, fail={hourly_fail}, total={hourly_total}")
                
                # if hourly_success != total_success or hourly_fail != total_fail or hourly_total != total_qty:
                #     print("WARNING: Hourly totals do not match raw data totals!")
                    # In case of discrepancy, you can optionally normalize hourly data to match raw totals
                    # But this could hide underlying issues, so we'll keep it commented for now
                    # total_factor = total_qty / hourly_total if hourly_total > 0 else 1
                    # for hour in hourly_data:
                    #     hour['success_qty'] = int(hour['success_qty'] * total_factor)
                    #     hour['fail_qty'] = int(hour['fail_qty'] * total_factor)
                    #     hour['total_qty'] = hour['success_qty'] + hour['fail_qty']
                # else:
                #     print("Verification successful: Hourly totals match raw data totals")
                
                # Finalize the response data
                response_data = {
                    'unit_name': unit_name,
                    'total_success': total_success,
                    'total_fail': total_fail,
                    'total_qty': total_qty,
                    'total_quality': total_quality if total_quality is not None else 0,
                    'total_performance': total_performance if total_performance is not None else 0,
                    'total_oee': total_oee if total_oee is not None else 0,
                    'hourly_data': hourly_data
                }
                
                # Ensure all values are valid for JSON serialization
                for hour_data in response_data['hourly_data']:
                    if hour_data['quality'] is None:
                        hour_data['quality'] = 0
                    if hour_data['performance'] is None:
                        hour_data['performance'] = 0
                    if hour_data['oee'] is None:
                        hour_data['oee'] = 0
                
                # Check if connection is still open before sending
                if websocket.client_state.name == 'CONNECTED':
                    await websocket.send_json(response_data)
                    # print(f"=== Sent updated data to client at {datetime.now(TIMEZONE)} ===\n")
                else:
                    # print("WebSocket connection closed, cannot send response")
                    break
                    
                await asyncio.sleep(30)
            except WebSocketDisconnect:
                # If websocket is disconnected during processing, break the loop
                # print(f"Hourly WebSocket disconnected during processing for {unit_name}")
                break
            except ValueError as e:
                # print(f"Error processing hourly WebSocket data: {e}")
                try:
                    error_response = {"error": str(e)}
                    await websocket.send_json(error_response)
                except Exception as e:
                    # Handle any exception during error response sending
                    # print(f"Could not send error response: {str(e)}")
                    break
            except Exception as e:
                # print(f"Unexpected error in hourly WebSocket connection: {e}")
                try:
                    error_response = {"error": "An unexpected error occurred"}
                    await websocket.send_json(error_response)
                except Exception as send_err:
                    # Handle any exception during error response sending
                    # print(f"Could not send error response: {str(send_err)}")
                    break
    except Exception as e:
        print(f"Outer exception in hourly WebSocket handler: {e}")
    finally:
        manager.disconnect(websocket, 'hourly')
        # print(f"Hourly WebSocket connection cleaned up for {unit_name}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 