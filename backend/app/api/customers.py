from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_permission
from app.models.customer import Customer
from app.models.user import User
from app.permissions import Permissions
from app.schemas.customer import CustomerCreate, CustomerListResponse, CustomerResponse, CustomerUpdate
from app.services.audit import AuditService

router = APIRouter(prefix="/api/customers", tags=["customers"])


@router.get("/all", response_model=CustomerListResponse)
@router.get("", response_model=CustomerListResponse)
async def list_customers(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query(None),
    is_active: bool = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_VIEW)),
):
    query = select(Customer)

    if search:
        query = query.where(
            or_(
                Customer.name.ilike(f"%{search}%"),
                Customer.code.ilike(f"%{search}%"),
                Customer.phone.ilike(f"%{search}%"),
                Customer.obm_customer_code.ilike(f"%{search}%"),
            )
        )
    if is_active is not None:
        query = query.where(Customer.is_active == is_active)

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar()

    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    customers = result.scalars().all()

    return CustomerListResponse(
        items=[CustomerResponse.model_validate(c) for c in customers],
        total=total,
        page=page,
        page_size=page_size,
        pages=(total + page_size - 1) // page_size if page_size > 0 else 0,
    )


@router.post("", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
async def create_customer(
    body: CustomerCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_MANAGE)),
):
    if body.code:
        existing = await db.execute(
            select(Customer).where(Customer.code == body.code)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Customer with this code already exists",
            )

    customer = Customer(
        **body.model_dump(),
        created_by=current_user.id,
    )
    db.add(customer)
    await db.flush()

    await AuditService.log(
        db=db,
        action="customers.create",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="customer",
        entity_id=customer.id,
        entity_label=customer.name,
        new_values=body.model_dump(),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    await db.refresh(customer)
    return CustomerResponse.model_validate(customer)


@router.get("/{customer_id}", response_model=CustomerResponse)
async def get_customer(
    customer_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_VIEW)),
):
    result = await db.execute(select(Customer).where(Customer.id == customer_id))
    customer = result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    return CustomerResponse.model_validate(customer)


@router.patch("/{customer_id}", response_model=CustomerResponse)
async def update_customer(
    customer_id: int,
    body: CustomerUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_MANAGE)),
):
    result = await db.execute(select(Customer).where(Customer.id == customer_id))
    customer = result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")

    old_values = {k: getattr(customer, k) for k in body.model_fields if getattr(customer, k, None) is not None}

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(customer, field, value)

    await AuditService.log(
        db=db,
        action="customers.update",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="customer",
        entity_id=customer.id,
        entity_label=customer.name,
        old_values=old_values,
        new_values=update_data,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()
    await db.refresh(customer)
    return CustomerResponse.model_validate(customer)


@router.delete("/{customer_id}")
async def delete_customer(
    customer_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(Permissions.CUSTOMERS_MANAGE)),
):
    result = await db.execute(select(Customer).where(Customer.id == customer_id))
    customer = result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")

    await AuditService.log(
        db=db,
        action="customers.delete",
        actor_user_id=current_user.id,
        actor_role_at_time=current_user.role,
        entity_type="customer",
        entity_id=customer.id,
        entity_label=customer.name,
        old_values={"name": customer.name, "code": customer.code},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await db.delete(customer)
    await db.commit()
    return {"message": "Customer deleted"}
