from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from datetime import datetime, timedelta
import json
import asyncio
import os
import time
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

@app.get("/hourly-historical.js")
async def get_hourly_historical_js():
    return FileResponse(os.path.join(FRONTEND_DIR, "hourly-historical.js"))

@app.get("/standart-historical.js")
async def get_standart_historical_js():
    return FileResponse(os.path.join(FRONTEND_DIR, "standart-historical.js"))

# Standard view route
@app.get("/standart.html")
async def get_standart_html():
    file_path = os.path.join(FRONTEND_DIR, "standart.html")
    if os.path.exists(file_path):
        return FileResponse(file_path)
    else:
        raise HTTPException(status_code=404, detail=f"File not found at {file_path}")

@app.get("/standart-historical.html")
async def get_standart_historical_html():
    file_path = os.path.join(FRONTEND_DIR, "standart-historical.html")
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

@app.get("/hourly-historical.html")
async def get_hourly_historical_html():
    file_path = os.path.join(FRONTEND_DIR, "hourly-historical.html")
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

# Historical Report routes
@app.get("/report-historical")
async def get_report_historical():
    report_file_path = os.path.join(FRONTEND_DIR, "report-historical.html")
    if os.path.exists(report_file_path):
        return FileResponse(report_file_path)
    else:
        raise HTTPException(status_code=404, detail="Historical report page not found")

@app.get("/report-historical.js")
async def get_report_historical_js():
    report_js_path = os.path.join(FRONTEND_DIR, "report-historical.js")
    if os.path.exists(report_js_path):
        return FileResponse(report_js_path, media_type="application/javascript")
    else:
        raise HTTPException(status_code=404, detail="Historical report JavaScript not found")

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

@app.get("/report-data")
async def get_report_data(units: str, start_time: str, end_time: str, working_mode: str = 'mode1'):
    """
    Get aggregated report data for multiple units with weighted performance calculations
    """
    try:
        # Parse unit list (comma-separated)
        unit_list = [unit.strip() for unit in units.split(',') if unit.strip()]
        
        if not unit_list:
            raise HTTPException(status_code=400, detail="No units specified")
        
        # Fix ISO format strings with 'Z' timezone
        start_time_str = start_time.replace('Z', '+00:00')
        end_time_str = end_time.replace('Z', '+00:00')
        
        # Parse timestamps as UTC first
        start_time = datetime.fromisoformat(start_time_str)
        end_time = datetime.fromisoformat(end_time_str)
        
        # Convert to application timezone (GMT+3)
        if start_time.tzinfo is not None:
            start_time = start_time.astimezone(TIMEZONE)
            end_time = end_time.astimezone(TIMEZONE)
        
        # Get current time in GMT+3
        current_time = datetime.now(TIMEZONE)
        
        # Collect data for all units
        unit_data = {}
        total_success_all = 0
        total_fail_all = 0
        weighted_quality_sum = 0
        weighted_performance_sum = 0
        total_production_all = 0
        total_success_weight = 0
        
        for unit_name in unit_list:
            # Get production data for this unit
            production_data = get_production_data(unit_name, start_time, end_time, current_time, working_mode)
            
            # Calculate unit totals
            unit_success = sum(model['success_qty'] for model in production_data)
            unit_fail = sum(model['fail_qty'] for model in production_data)
            unit_total = unit_success + unit_fail
            
            # Calculate unit quality
            unit_quality = unit_success / unit_total if unit_total > 0 else 0
            
            # Calculate unit performance as sum of model performances
            unit_performance_sum = 0
            for model in production_data:
                if model.get('performance') is not None:
                    unit_performance_sum += model['performance']
            
            # Store unit data
            unit_data[unit_name] = {
                'total_success': unit_success,
                'total_fail': unit_fail,
                'total_qty': unit_total,
                'quality': unit_quality,
                'performance_sum': unit_performance_sum,
                'models': production_data
            }
            
            # Add to overall totals
            total_success_all += unit_success
            total_fail_all += unit_fail
            total_production_all += unit_total
            
            # Add to weighted sums
            if unit_total > 0:
                weighted_quality_sum += unit_quality * unit_total
            
            if unit_success > 0:
                weighted_performance_sum += unit_performance_sum * unit_success
                total_success_weight += unit_success
        
        # Calculate overall weighted averages
        overall_quality = weighted_quality_sum / total_production_all if total_production_all > 0 else 0
        overall_performance = weighted_performance_sum / total_success_weight if total_success_weight > 0 else 0
        
        return {
            'units': unit_data,
            'summary': {
                'total_success': total_success_all,
                'total_fail': total_fail_all,
                'total_production': total_production_all,
                'weighted_quality': overall_quality,
                'weighted_performance': overall_performance
            }
        }
        
    except Exception as e:
        print(f"Error in report data endpoint: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/historical-data/{unit_name}")
async def get_historical_data(unit_name: str, start_time: str, end_time: str, working_mode: str = 'mode1'):
    try:
        # Fix ISO format strings with 'Z' timezone
        start_time_str = start_time.replace('Z', '+00:00')
        end_time_str = end_time.replace('Z', '+00:00')
        
        # Parse timestamps as UTC first
        start_time = datetime.fromisoformat(start_time_str)
        end_time = datetime.fromisoformat(end_time_str)
        
        # Convert to application timezone (GMT+3)
        if start_time.tzinfo is not None:
            start_time = start_time.astimezone(TIMEZONE)
            end_time = end_time.astimezone(TIMEZONE)
        
        # Get current time in GMT+3
        current_time = datetime.now(TIMEZONE)
        
        # Get production data
        production_data = get_production_data(unit_name, start_time, end_time, current_time, working_mode)
        
        # Calculate totals
        total_success = sum(model['success_qty'] for model in production_data)
        total_fail = sum(model['fail_qty'] for model in production_data)
        total_qty = sum(model['total_qty'] for model in production_data)
        
        # Calculate quality (success / processed, not total)
        total_processed = total_success + total_fail
        total_quality = total_success / total_processed if total_processed > 0 else 0
        
        # Calculate performance and theoretical quantity
        models_with_target = [model for model in production_data if model['target'] is not None and model['target'] > 0]
        total_performance = None
        total_theoretical_qty = 0
        
        if models_with_target:
            # Calculate operation time
            operation_time_total = (end_time - start_time).total_seconds()
            break_time = calculate_break_time(start_time, end_time, working_mode)
            operation_time = max(operation_time_total - break_time, 0)
            
            # Calculate theoretical quantity using weighted average target rate
            total_actual_qty = sum(model['total_qty'] for model in models_with_target)
            
            if total_actual_qty > 0:
                weighted_target_rate = 0
                for model in models_with_target:
                    weight = model['total_qty'] / total_actual_qty
                    weighted_target_rate += weight * model['target']
                
                # Calculate theoretical quantity using weighted average rate
                total_theoretical_qty = (operation_time / 3600) * weighted_target_rate
                
                # Calculate performance
                total_performance = total_actual_qty / total_theoretical_qty if total_theoretical_qty > 0 else 0
        
        # Calculate unit performance as sum of all model performances
        unit_performance_sum = 0
        for model in production_data:
            if model.get('performance') is not None:
                unit_performance_sum += model['performance']
        
        return {
            'unit_name': unit_name,
            'total_success': total_success,
            'total_fail': total_fail,
            'total_qty': total_qty,
            'total_quality': total_quality,
            'total_performance': total_performance if total_performance is not None else 0,
            'unit_performance_sum': unit_performance_sum,  # New: sum of model performances
            'total_theoretical_qty': total_theoretical_qty,
            'models': production_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/historical-hourly-data/{unit_name}")
async def get_historical_hourly_data(unit_name: str, start_time: str, end_time: str, working_mode: str = 'mode1'):
    try:
        # Fix ISO format strings with 'Z' timezone
        start_time_str = start_time.replace('Z', '+00:00')
        end_time_str = end_time.replace('Z', '+00:00')
        
        # Parse timestamps as UTC first
        start_time = datetime.fromisoformat(start_time_str)
        end_time = datetime.fromisoformat(end_time_str)
        
        # Convert to application timezone (GMT+3)
        if start_time.tzinfo is not None:
            start_time = start_time.astimezone(TIMEZONE)
            end_time = end_time.astimezone(TIMEZONE)
        
        # Get current time in GMT+3
        current_time = datetime.now(TIMEZONE)
        
        # Since get_production_data returns aggregated data, we need to query hour by hour
        hourly_data = []
        current_hour = start_time.replace(minute=0, second=0, microsecond=0)
        
        # Calculate totals
        total_success = 0
        total_fail = 0
        total_qty = 0
        
        while current_hour < end_time:
            hour_end = min(current_hour + timedelta(hours=1), end_time)
            
            # Get data for this specific hour
            hour_data = get_production_data(unit_name, current_hour, hour_end, current_time, working_mode)
            
            # Calculate hourly totals
            hour_success = sum(model['success_qty'] for model in hour_data)
            hour_fail = sum(model['fail_qty'] for model in hour_data)
            hour_total = sum(model['total_qty'] for model in hour_data)
            
            # Add to overall totals
            total_success += hour_success
            total_fail += hour_fail
            total_qty += hour_total
            
            # Calculate hourly quality
            hour_quality = hour_success / (hour_success + hour_fail) if (hour_success + hour_fail) > 0 else 0
            
            # Calculate hourly performance and theoretical quantity
            models_with_target = [model for model in hour_data if model['target'] is not None and model['target'] > 0]
            hour_performance = 0
            hour_theoretical_qty = 0
            
            if models_with_target:
                # Calculate operation time for this hour
                hour_operation_time = (hour_end - current_hour).total_seconds()
                hour_break_time = calculate_break_time(current_hour, hour_end, working_mode)
                hour_operation_time = max(hour_operation_time - hour_break_time, 0)
                
                # Calculate theoretical quantity using weighted average target rate
                hour_actual_qty = sum(model['total_qty'] for model in models_with_target)
                
                if hour_actual_qty > 0:
                    weighted_target_rate = 0
                    for model in models_with_target:
                        weight = model['total_qty'] / hour_actual_qty
                        weighted_target_rate += model['target'] * weight
                    
                    # Calculate theoretical quantity using weighted average rate
                    hour_theoretical_qty = (hour_operation_time / 3600) * weighted_target_rate
                    
                    # Calculate performance
                    hour_performance = hour_actual_qty / hour_theoretical_qty if hour_theoretical_qty > 0 else 0
            
            hourly_data.append({
                'hour_start': current_hour.isoformat(),
                'hour_end': hour_end.isoformat(),
                'success_qty': hour_success,
                'fail_qty': hour_fail,
                'total_qty': hour_total,
                'quality': hour_quality,
                'performance': hour_performance,
                'theoretical_qty': hour_theoretical_qty
            })
            
            current_hour = hour_end
        
        # Calculate overall metrics
        total_quality = total_success / (total_success + total_fail) if (total_success + total_fail) > 0 else 0
        
        # Calculate overall performance
        total_performance = 0
        total_theoretical_qty = sum(hour['theoretical_qty'] for hour in hourly_data)
        
        if total_theoretical_qty > 0:
            total_performance = total_qty / total_theoretical_qty
        
        return {
            'unit_name': unit_name,
            'total_success': total_success,
            'total_fail': total_fail,
            'total_qty': total_qty,
            'total_quality': total_quality,
            'total_performance': total_performance,
            'total_theoretical_qty': total_theoretical_qty,
            'hourly_data': hourly_data
        }
    except Exception as e:
        print(f"Error in historical hourly data endpoint: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# WebSocket endpoint for standard dashboard
@app.websocket("/ws/{unit_name}")
async def websocket_endpoint(websocket: WebSocket, unit_name: str):
    await manager.connect(websocket, 'standard')
    try:
        while True:
            try:
                data = await websocket.receive_text()
                params = json.loads(data)
                
                # SLOW NETWORK FIX: Handle heartbeat requests
                if params.get('heartbeat'):
                    # Send lightweight heartbeat response
                    if websocket.client_state.name == 'CONNECTED':
                        await websocket.send_json({"heartbeat": True, "timestamp": time.time()})
                        print(f"[HEARTBEAT] Sent heartbeat response to {unit_name}")
                    continue
                
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
                
                # Calculate unit performance as sum of all model performances
                unit_performance_sum = 0
                for model in production_data:
                    if model.get('performance') is not None:
                        unit_performance_sum += model['performance']
                
                # Create response with both individual model data and summary
                response_data = {
                    'unit_name': unit_name,
                    'models': production_data,
                    'summary': {
                        'total_success': total_success,
                        'total_fail': total_fail,
                        'total_qty': total_qty,
                        'total_quality': total_quality,
                        'total_performance': total_performance,
                        'unit_performance_sum': unit_performance_sum  # New: sum of model performances
                    }
                }
                
                
                # Check if connection is still open before sending
                if websocket.client_state.name == 'CONNECTED':
                    await websocket.send_json(response_data)
                    print(f"[STANDARD SUCCESS] Sent response to {unit_name}")
                else:
                    print(f"[STANDARD WARNING] Connection closed before sending response to {unit_name}")
                    break
                    
                # FIXED: Much shorter sleep for real-time standard updates  
                await asyncio.sleep(10)  # 10 seconds instead of 30 for responsive real-time updates
            except WebSocketDisconnect:
                print(f"[STANDARD INFO] WebSocket disconnected for {unit_name}")
                break
            except ValueError as e:
                try:
                    error_response = {"error": str(e)}
                    print(f"[STANDARD ERROR] Value error for {unit_name}: {str(e)}")
                    if websocket.client_state.name == 'CONNECTED':
                        await websocket.send_json(error_response)
                except Exception:
                    break
            except Exception as e:
                # Filter out normal WebSocket connection closures - these are expected
                error_msg = str(e).lower()
                if ('keepalive ping timeout' in error_msg or '1011' in error_msg or 
                    'connection closed' in error_msg or '1005' in error_msg or 
                    'no status received' in error_msg):
                    # Normal WebSocket connection closure - log at lower level
                    print(f"[STANDARD INFO] WebSocket connection closed for {unit_name} (normal): {str(e)}")
                    break
                else:
                    # Actual error - log with full traceback and send error response
                    print(f"[STANDARD ERROR] Unexpected error in WebSocket handler for {unit_name}: {str(e)}")
                    import traceback
                    traceback.print_exc()
                
                try:
                    error_response = {"error": f"Server error occurred: {str(e)}"}
                    if websocket.client_state.name == 'CONNECTED':
                        await websocket.send_json(error_response)
                        print(f"[STANDARD ERROR] Sent error response to {unit_name}")
                except Exception as send_err:
                    # Filter out normal connection closed errors for send failures too
                    send_error_msg = str(send_err).lower()
                    if ('keepalive ping timeout' not in send_error_msg and '1011' not in send_error_msg and 
                        'connection closed' not in send_error_msg and '1005' not in send_error_msg and 
                        'no status received' not in send_error_msg):
                        print(f"[STANDARD ERROR] Failed to send error response to {unit_name}: {str(send_err)}")
                    break
    except Exception as e:
        # Filter out normal WebSocket connection closures for outer exceptions too
        error_msg = str(e).lower()
        if ('keepalive ping timeout' in error_msg or '1011' in error_msg or 
            'connection closed' in error_msg or '1005' in error_msg or 
            'no status received' in error_msg):
            print(f"[STANDARD INFO] Outer WebSocket connection closed (normal): {e}")
        else:
            print(f"Outer exception in standard WebSocket handler: {e}")
    finally:
        manager.disconnect(websocket, 'standard')

# ROBUST OPTIMIZATION: Add simple caching to reduce database load for hourly data
hourly_data_cache = {}
cache_duration = 30  # Cache for 30 seconds to balance performance and freshness

# WebSocket endpoint for hourly data
@app.websocket("/ws/hourly/{unit_name}")
async def hourly_websocket_endpoint(websocket: WebSocket, unit_name: str):
    await manager.connect(websocket, 'hourly')
    try:
        while True:
            try:
                data = await websocket.receive_text()
                params = json.loads(data)
                
                # SLOW NETWORK FIX: Handle heartbeat requests for hourly endpoint
                if params.get('heartbeat'):
                    # Send lightweight heartbeat response
                    if websocket.client_state.name == 'CONNECTED':
                        await websocket.send_json({"heartbeat": True, "timestamp": time.time()})
                        print(f"[HOURLY HEARTBEAT] Sent heartbeat response to {unit_name}")
                    continue
                
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
                
                # Direct calculation of quality as success/processed
                total_processed = total_success + total_fail
                total_quality = total_success / total_processed if total_processed > 0 else 0
                
                # Calculate total performance and OEE using the raw model data
                models_with_target = [model for model in raw_data if model['target'] is not None and model['target'] > 0]
                total_performance = None
                total_oee = None
                total_theoretical_qty = 0
                total_theoretical_time = 0
                
                if models_with_target:
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
                    total_theoretical_qty = 0
                    total_theoretical_time = 0
                    total_actual_qty = sum(model['total_qty'] for model in models_with_target)
                    
                    if total_actual_qty > 0:
                        weighted_target_rate = 0
                        for model in models_with_target:
                            weight = model['total_qty'] / total_actual_qty
                            weighted_target_rate += weight * model['target']
                            # Calculate theoretical time for performance calculation
                            if model['target'] > 0:  # Safety check to prevent division by zero
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
                
                # Process hourly data hour by hour (same approach as historical hourly endpoint)
                hourly_data = []
                current_hour = start_time.replace(minute=0, second=0, microsecond=0)
                
                # Determine if this is live data to use current_time for the last hour
                is_live_data = False
                actual_end_time_for_hourly = end_time
                if current_time:
                    time_difference = current_time - end_time
                    five_minutes = timedelta(minutes=5)
                    is_live_data = time_difference <= five_minutes
                    
                    # FIXED: For live data, extend the processing to current_time to include current hour
                    if is_live_data:
                        actual_end_time_for_hourly = current_time
                        print(f"[HOURLY DEBUG] Live data detected - extending end_time from {end_time} to {current_time}")
                
                while current_hour < actual_end_time_for_hourly:
                    hour_end = current_hour + timedelta(hours=1)
                    
                    # For the current hour in live data, use current_time as hour_end
                    if is_live_data and current_time > current_hour and current_time < hour_end:
                        # This is the current hour in live data - use current_time as hour_end
                        hour_end = current_time
                        print(f"[HOURLY DEBUG] Current hour detected: {current_hour.strftime('%H:%M')} - using current_time as hour_end: {hour_end.strftime('%H:%M')}")
                    else:
                        # For historical data or completed hours, use the regular hour boundary or actual_end_time_for_hourly
                        hour_end = min(hour_end, actual_end_time_for_hourly)
                    
                    # ROBUST OPTIMIZATION: Use smart caching to reduce database calls
                    # Create cache key for this specific hour query
                    cache_key = f"{unit_name}_{current_hour.isoformat()}_{hour_end.isoformat()}_{working_mode}"
                    current_timestamp = time.time()
                    
                    # Check if we have recent cached data for this exact query
                    if (cache_key in hourly_data_cache and 
                        current_timestamp - hourly_data_cache[cache_key]['timestamp'] < cache_duration):
                        # Use cached data (significantly faster)
                        hour_data = hourly_data_cache[cache_key]['data']
                        print(f"[HOURLY CACHE] Using cached data for {unit_name} hour {current_hour.strftime('%H:%M')}")
                    else:
                        # Get fresh data from database (maintains exact same business logic)
                        hour_data = get_production_data(unit_name, current_hour, hour_end, current_time, working_mode)
                        
                        # Cache the result for future requests
                        hourly_data_cache[cache_key] = {
                            'data': hour_data,
                            'timestamp': current_timestamp
                        }
                        print(f"[HOURLY CACHE] Fetched fresh data for {unit_name} hour {current_hour.strftime('%H:%M')}")
                        
                        # Clean up old cache entries to prevent memory growth
                        keys_to_remove = []
                        for key, cached_item in hourly_data_cache.items():
                            if current_timestamp - cached_item['timestamp'] > cache_duration * 2:
                                keys_to_remove.append(key)
                        for key in keys_to_remove:
                            del hourly_data_cache[key]
                    
                    # Calculate hourly totals
                    hour_success = sum(model['success_qty'] for model in hour_data)
                    hour_fail = sum(model['fail_qty'] for model in hour_data)
                    hour_total = sum(model['total_qty'] for model in hour_data)
                    
                    # Calculate hourly quality
                    hour_quality = hour_success / (hour_success + hour_fail) if (hour_success + hour_fail) > 0 else 0
                    
                    # Calculate hourly performance and theoretical quantity
                    models_with_target = [model for model in hour_data if model['target'] is not None and model['target'] > 0]
                    hour_performance = 0
                    hour_theoretical_qty = 0
                    
                    if models_with_target:
                        # Calculate operation time for this hour
                        hour_operation_time = (hour_end - current_hour).total_seconds()
                        hour_break_time = calculate_break_time(current_hour, hour_end, working_mode)
                        hour_operation_time = max(hour_operation_time - hour_break_time, 0)
                        
                        # Calculate theoretical quantity using weighted average target rate
                        hour_actual_qty = sum(model['total_qty'] for model in models_with_target)
                        
                        if hour_actual_qty > 0:
                            weighted_target_rate = 0
                            for model in models_with_target:
                                weight = model['total_qty'] / hour_actual_qty
                                weighted_target_rate += model['target'] * weight
                            
                            # Calculate theoretical quantity using weighted average rate
                            hour_theoretical_qty = (hour_operation_time / 3600) * weighted_target_rate
                            
                            # Calculate performance
                            hour_performance = hour_actual_qty / hour_theoretical_qty if hour_theoretical_qty > 0 else 0
                    
                    hourly_data.append({
                        'hour_start': current_hour.isoformat(),
                        'hour_end': hour_end.isoformat(),
                        'success_qty': hour_success,
                        'fail_qty': hour_fail,
                        'total_qty': hour_total,
                        'quality': hour_quality,
                        'performance': hour_performance,
                        'oee': 0,  # OEE set to 0 as per requirements
                        'theoretical_qty': hour_theoretical_qty
                    })
                    
                    print(f"[HOURLY DEBUG] Added hour: {current_hour.strftime('%H:%M')}-{hour_end.strftime('%H:%M')} | Success: {hour_success} | Fail: {hour_fail}")
                    
                    # Move to next hour - but for live data current hour, advance to the next hour boundary
                    if is_live_data and hour_end == current_time:
                        # For current hour in live data, move to next hour boundary to prevent infinite loop
                        current_hour = current_hour + timedelta(hours=1)
                        print(f"[HOURLY DEBUG] Current hour processed, moving to next hour boundary: {current_hour.strftime('%H:%M')}")
                    else:
                        current_hour = hour_end
                
                # Calculate corrected total theoretical quantity (sum of hourly calculations)
                total_theoretical_qty = sum(hour['theoretical_qty'] for hour in hourly_data)
                
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
                
                # HEARTBEAT TIMEOUT FIX: More robust connection checking before sending
                try:
                    if websocket.client_state.name == 'CONNECTED':
                        await websocket.send_json(response_data)
                        print(f"[HOURLY SUCCESS] Sent response to {unit_name} with {len(hourly_data)} hours")
                    else:
                        print(f"[HOURLY WARNING] Connection closed before sending response to {unit_name}")
                        break
                except Exception as send_err:
                    # Handle heartbeat timeout and connection errors during send
                    send_error_msg = str(send_err).lower()
                    if ('heartbeat timeout' in send_error_msg or 'connection closed' in send_error_msg or 
                        '1000' in send_error_msg or '1011' in send_error_msg):
                        print(f"[HOURLY INFO] Normal connection closure during send to {unit_name}: {str(send_err)}")
                    else:
                        print(f"[HOURLY ERROR] Failed to send response to {unit_name}: {str(send_err)}")
                    break
                    
                # OPTIMIZED: Faster sleep for real-time hourly updates with caching
                await asyncio.sleep(8)  # 8 seconds - faster with caching to reduce load
            except WebSocketDisconnect:
                print(f"[HOURLY INFO] WebSocket disconnected for {unit_name}")
                break
            except json.JSONDecodeError as e:
                try:
                    error_response = {"error": f"Invalid JSON format: {str(e)}"}
                    print(f"[HOURLY ERROR] JSON decode error for {unit_name}: {str(e)}")
                    if websocket.client_state.name == 'CONNECTED':
                        await websocket.send_json(error_response)
                except Exception:
                    break
            except ValueError as e:
                try:
                    error_response = {"error": str(e)}
                    print(f"[HOURLY ERROR] Value error for {unit_name}: {str(e)}")
                    if websocket.client_state.name == 'CONNECTED':
                        await websocket.send_json(error_response)
                except Exception:
                    break
            except Exception as e:
                # Filter out normal WebSocket connection closures - these are expected
                error_msg = str(e).lower()
                if ('keepalive ping timeout' in error_msg or 'heartbeat timeout' in error_msg or '1011' in error_msg or 
                    'connection closed' in error_msg or '1005' in error_msg or '1000' in error_msg or
                    'no status received' in error_msg):
                    # Normal WebSocket connection closure - log at lower level
                    print(f"[HOURLY INFO] WebSocket connection closed for {unit_name} (normal): {str(e)}")
                    break
                else:
                    # Actual error - log with full traceback and send error response
                    print(f"[HOURLY ERROR] Unexpected error in WebSocket handler for {unit_name}: {str(e)}")
                import traceback
                traceback.print_exc()
                
                try:
                    error_response = {"error": f"Server error occurred: {str(e)}"}
                    if websocket.client_state.name == 'CONNECTED':
                        await websocket.send_json(error_response)
                        print(f"[HOURLY ERROR] Sent error response to {unit_name}")
                except Exception as send_err:
                    # Filter out normal connection closed errors for send failures too
                    send_error_msg = str(send_err).lower()
                    if ('keepalive ping timeout' not in send_error_msg and 'heartbeat timeout' not in send_error_msg and 
                        '1011' not in send_error_msg and '1000' not in send_error_msg and
                        'connection closed' not in send_error_msg and '1005' not in send_error_msg and 
                        'no status received' not in send_error_msg):
                        print(f"[HOURLY ERROR] Failed to send error response to {unit_name}: {str(send_err)}")
                    break
    except Exception as e:
        # Filter out normal WebSocket connection closures for outer exceptions too
        error_msg = str(e).lower()
        if ('keepalive ping timeout' in error_msg or 'heartbeat timeout' in error_msg or '1011' in error_msg or 
            'connection closed' in error_msg or '1005' in error_msg or '1000' in error_msg or
            'no status received' in error_msg):
            print(f"[HOURLY INFO] Outer WebSocket connection closed (normal): {e}")
        else:
            print(f"Outer exception in hourly WebSocket handler: {e}")
    finally:
        manager.disconnect(websocket, 'hourly')

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 