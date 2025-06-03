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
                
                # Calculate overall summary metrics (backend-calculated)
                total_success = sum(model['success_qty'] for model in production_data)
                total_fail = sum(model['fail_qty'] for model in production_data)
                total_qty = sum(model['total_qty'] for model in production_data)
                
                # Calculate weighted quality
                total_processed = total_success + total_fail
                total_quality = total_success / total_processed if total_processed > 0 else 0
                
                # Calculate overall performance as total actual / total theoretical (same logic as hourly view)
                models_with_target = [model for model in production_data if model['target'] is not None and model['target'] > 0]
                total_performance = 0
                if models_with_target:
                    # Calculate total actual quantity
                    total_actual_qty = sum(model['total_qty'] for model in models_with_target)
                    
                    # Calculate total theoretical quantity using weighted average target rate
                    # Use weighted average since models compete for the same production capacity
                    total_theoretical_qty = 0
                    
                    if total_actual_qty > 0:
                        # Calculate weighted average target rate based on actual production mix
                        weighted_target_rate = 0
                        for model in models_with_target:
                            weight = model['total_qty'] / total_actual_qty
                            weighted_target_rate += weight * model['target']
                        
                        # Get operation time for theoretical calculation (same logic as database.py)
                        # Need to determine actual end time for calculation
                        actual_end_time_for_calculation = end_time
                        if current_time:
                            time_difference = current_time - end_time
                            five_minutes = timedelta(minutes=5)
                            
                            # Only use current_time for live data (end_time is within 5 minutes of current_time)
                            if time_difference <= five_minutes:
                                actual_end_time_for_calculation = current_time
                            else:
                                actual_end_time_for_calculation = end_time
                        
                        operation_time_total = (actual_end_time_for_calculation - start_time).total_seconds() if actual_end_time_for_calculation > start_time else 0
                        break_time = calculate_break_time(start_time, actual_end_time_for_calculation, working_mode)
                        operation_time = max(operation_time_total - break_time, 0)
                        
                        # Calculate theoretical quantity using weighted average rate
                        total_theoretical_qty = (operation_time / 3600) * weighted_target_rate
                    else:
                        total_theoretical_qty = 0
                    
                    # Calculate overall performance as actual/theoretical ratio
                    total_performance = total_actual_qty / total_theoretical_qty if total_theoretical_qty > 0 else 0
                
                # Create response with both individual model data and summary
                response_data = {
                    'unit_name': unit_name,
                    'models': production_data,
                    'summary': {
                        'total_success': total_success,
                        'total_fail': total_fail,
                        'total_qty': total_qty,
                        'total_quality': total_quality,
                        'total_performance': total_performance
                    }
                }
                
                
                # Check if connection is still open before sending
                if websocket.client_state.name == 'CONNECTED':
                    await websocket.send_json(response_data)
                else:
                    break
                    
                await asyncio.sleep(30)
            except WebSocketDisconnect:
                break
            except ValueError as e:
                print(f"[STANDARD DEBUG] ValueError: {e}")
                try:
                    error_response = {"error": str(e)}
                    await websocket.send_json(error_response)
                except Exception as e:
                    break
            except Exception as e:
                print(f"[STANDARD DEBUG] Exception: {e}")
                try:
                    error_response = {"error": "An unexpected error occurred"}
                    await websocket.send_json(error_response)
                except Exception as send_err:
                    break
    except Exception as e:
        print(f"Outer exception in standard WebSocket handler: {e}")
    finally:
        manager.disconnect(websocket, 'standard')

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
                
                # Get all raw data in one query for the entire time range
                raw_data = get_production_data(unit_name, start_time, end_time, current_time, working_mode)
                
                # Calculate totals from raw data first
                total_success = sum(model['success_qty'] for model in raw_data)
                total_fail = sum(model['fail_qty'] for model in raw_data)
                total_qty = sum(model['total_qty'] for model in raw_data)
                
                # Direct calculation of quality as success/total
                total_quality = total_success / total_qty if total_qty > 0 else 0
                
                # Calculate total performance and OEE using the raw model data
                models_with_target = [model for model in raw_data if model['target'] is not None]
                total_performance = None
                total_oee = None
                total_theoretical_qty = 0
                total_theoretical_time = 0
                
                if models_with_target:
                    # Use same historical vs live detection logic as the hourly processing below
                    # Detect if this is historical data or live data
                    actual_end_time_for_calculation = end_time
                    if current_time:
                        time_difference = current_time - end_time
                        five_minutes = timedelta(minutes=5)
                        
                        # Only use current_time for live data (end_time is within 5 minutes of current_time)
                        if time_difference <= five_minutes:
                            # This is live data - use current_time
                            actual_end_time_for_calculation = current_time
                        else:
                            # This is historical data - use the original end_time
                            actual_end_time_for_calculation = end_time
                    
                    operation_time_total = (actual_end_time_for_calculation - start_time).total_seconds() if actual_end_time_for_calculation > start_time else 0
                    
                    # Calculate and subtract break time
                    break_time = calculate_break_time(start_time, actual_end_time_for_calculation, working_mode)
                    operation_time = operation_time_total - break_time
                    
                    # Ensure operation time is not negative
                    operation_time = max(operation_time, 0)
                    
                    # Calculate theoretical quantity using weighted average target rate
                    # Use weighted average since models compete for the same production capacity
                    total_theoretical_qty = 0
                    total_theoretical_time = 0
                    total_actual_qty = sum(model['total_qty'] for model in models_with_target)
                    
                    if total_actual_qty > 0:
                        weighted_target_rate = 0
                        for model in models_with_target:
                            weight = model['total_qty'] / total_actual_qty
                            weighted_target_rate += weight * model['target']
                            # Calculate theoretical time for performance calculation
                            model_theoretical_time = model['total_qty'] * (3600 / model['target'])
                            total_theoretical_time += model_theoretical_time
                        
                        # Calculate theoretical quantity using weighted average rate
                        total_theoretical_qty = (operation_time / 3600) * weighted_target_rate
                    else:
                        total_theoretical_qty = 0
                    
                    # Calculate overall performance as actual/theoretical ratio
                    total_performance = total_actual_qty / total_theoretical_qty if total_theoretical_qty > 0 else 0
                    
                    # Calculate overall OEE (set to None as per requirement #3)
                    total_oee = None
                else:
                    print("No models with target found")
                
                # Now process hourly data using the raw data
                hourly_data = []
                
                # Initialize hourly containers for the entire time range
                # Use the same time logic as get_production_data: detect historical vs live data
                container_start_time = start_time
                container_end_time = end_time
                
                # Detect if this is historical data or live data (same logic as get_production_data)
                if current_time:
                    time_difference = current_time - end_time
                    five_minutes = timedelta(minutes=5)
                    
                    # Only use current_time for live data (end_time is within 5 minutes of current_time)
                    if time_difference <= five_minutes:
                        # This is live data - use current_time as end_time
                        container_end_time = current_time
                        query_end_time = current_time
                    else:
                        # This is historical data - use the original end_time
                        container_end_time = end_time
                        query_end_time = end_time
                else:
                    query_end_time = end_time
                
                # Use the same table as get_production_data for consistency
                # Now use ProductRecordLogView since it contains all historical data and targets
                table_name = "ProductRecordLogView"
                
                current_hour = container_start_time.replace(minute=0, second=0, microsecond=0)
                hour_containers = {}
                
                while current_hour < container_end_time:
                    hour_end = min(current_hour + timedelta(hours=1), container_end_time)
                    
                    # Store both the full ISO format and the naive format for easier matching
                    hour_key = current_hour.isoformat()
                    
                    # Initialize hour container
                    hour_containers[hour_key] = {
                        'hour_start': current_hour,
                        'hour_end': hour_end,
                        'success_qty': 0,
                        'fail_qty': 0,
                        'total_qty': 0,
                        'is_current': current_hour <= current_time < hour_end if current_time else False
                    }
                    
                    # Move to next hour
                    current_hour += timedelta(hours=1)
                
                # Get detailed data directly using one query
                conn = get_db_connection()
                cursor = conn.cursor()
                
                # Ensure timezone conversion is applied to query parameters
                query_start_time = start_time
                query_end_time = query_end_time
                
                # Ensure both parameters have the same timezone format
                if query_start_time.tzinfo is None:
                    query_start_time = TIMEZONE.localize(query_start_time)
                elif query_start_time.tzinfo != TIMEZONE:
                    query_start_time = query_start_time.astimezone(TIMEZONE)
                    
                if query_end_time.tzinfo is None:
                    query_end_time = TIMEZONE.localize(query_end_time)
                elif query_end_time.tzinfo != TIMEZONE:
                    query_end_time = query_end_time.astimezone(TIMEZONE)
                
                # Single query to combined table - no more hybrid logic needed!
                detail_query = f"""
                SELECT 
                    Model,
                    KayitTarihi,
                    TestSonucu,
                    ModelSuresiSN as Target
                FROM 
                    {table_name}
                WHERE 
                    UnitName = ? 
                    AND KayitTarihi BETWEEN ? AND ?
                ORDER BY
                    KayitTarihi
                """
                
                cursor.execute(detail_query, (unit_name, query_start_time, query_end_time))
                all_records = cursor.fetchall()
                
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
                
                # Calculate metrics for each hour
                total_theoretical_qty_corrected = 0  # New variable to accumulate from hourly calculations
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
                        'oee': None,
                        'theoretical_qty': 0
                    }
                    
                    # Calculate quality
                    if hour_summary['total_qty'] > 0:
                        hour_summary['quality'] = hour_summary['success_qty'] / hour_summary['total_qty']
                    else:
                        hour_summary['quality'] = 0
                    
                    # Calculate performance, OEE, and theoretical quantity for this hour
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
                            
                            # Calculate theoretical time and theoretical quantity
                            hour_theoretical_time = 0
                            hour_theoretical_qty = 0
                            
                            # Calculate theoretical time for each model based on actual production
                            for model in models_with_target:
                                if model['target'] is not None and model['target'] > 0:
                                    # Calculate theoretical time for performance calculation
                                    model_theoretical_time = model['total_qty'] * (3600 / model['target'])
                                    hour_theoretical_time += model_theoretical_time
                            
                            # Calculate theoretical quantity using weighted average target rate
                            # Use weighted average since models compete for the same production capacity
                            total_actual_qty = sum(model['total_qty'] for model in models_with_target)
                            if total_actual_qty > 0:
                                weighted_target_rate = 0
                                for model in models_with_target:
                                    weight = model['total_qty'] / total_actual_qty
                                    weighted_target_rate += weight * model['target']
                                
                                # Calculate theoretical quantity using weighted average rate
                                hour_theoretical_qty = (operation_time / 3600) * weighted_target_rate
                            else:
                                hour_theoretical_qty = 0
                            
                            # Calculate performance as actual/theoretical ratio
                            if operation_time > 0 and hour_theoretical_qty > 0:
                                # Performance = actual production / theoretical production
                                hour_performance = total_actual_qty / hour_theoretical_qty
                                hour_summary['performance'] = hour_performance
                                hour_summary['oee'] = None  # Remove OEE calculation as per requirement #3
                                hour_summary['theoretical_qty'] = hour_theoretical_qty
                            else:
                                hour_summary['performance'] = 0
                                hour_summary['theoretical_qty'] = hour_theoretical_qty
                            
                            # Add this hour's theoretical quantity to the total
                            total_theoretical_qty_corrected += hour_theoretical_qty
                    
                    # Add hour to final data
                    hourly_data.append(hour_summary)
                    
                # Use the corrected total theoretical quantity (sum of hourly calculations)
                total_theoretical_qty = total_theoretical_qty_corrected
                
                # Finalize the response data
                response_data = {
                    'unit_name': unit_name,
                    'total_success': total_success,
                    'total_fail': total_fail,
                    'total_qty': total_qty,
                    'total_quality': total_quality if total_quality is not None else 0,
                    'total_performance': total_performance if total_performance is not None else 0,
                    'total_oee': total_oee if total_oee is not None else 0,
                    'total_theoretical_qty': total_theoretical_qty if total_theoretical_qty is not None else 0,
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
                else:
                    break
                    
                await asyncio.sleep(30)
            except WebSocketDisconnect:
                break
            except ValueError as e:
                try:
                    error_response = {"error": str(e)}
                    await websocket.send_json(error_response)
                except Exception as e:
                    break
            except Exception as e:
                try:
                    error_response = {"error": "An unexpected error occurred"}
                    await websocket.send_json(error_response)
                except Exception as send_err:
                    break
    except Exception as e:
        print(f"Outer exception in hourly WebSocket handler: {e}")
    finally:
        manager.disconnect(websocket, 'hourly')

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 